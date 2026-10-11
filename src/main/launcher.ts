import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, appendFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  Version,
  MinecraftFolder,
  createQuickPlayMultiplayer,
  launch,
  type ResolvedVersion,
} from '@xmcl/core'
import {
  getVersionList,
  getLoaderArtifactListFor,
  installFabric,
  installJavaRuntimeTask,
  installResolvedAssetsTask,
  installResolvedLibrariesTask,
  installVersionTask,
  type JavaRuntimeManifest,
  type MinecraftVersion,
} from '@xmcl/installer'
import type { Task, TaskContext } from '@xmcl/task'
import { offline } from '@xmcl/user'
import type {
  ContentInstallResult,
  ContentProject,
  ContentType,
  InstalledContent,
  LaunchResult,
  LauncherProgress,
  LauncherRuntimeState,
  LauncherSettings,
  MinecraftVersionOption,
} from '../shared/contracts'
import { ContentService } from './content'

export const GAME_VERSION = '26.1.2'
export const FABRIC_LOADER_VERSION = '0.19.3'
export const SERVER_HOST = 'play.kirazium.com'
export const SERVER_PORT = 25565

const execFileAsync = promisify(execFile)
const INSTALL_ATTEMPTS = 4
const RETRY_BASE_DELAY_MS = 850
const DOWNLOAD_BATCH_SIZE = 12
const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const JAVA_RUNTIME_INDEX_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

type ProgressListener = (progress: LauncherProgress) => void

export function selectVersionMetadata(
  versions: MinecraftVersion[],
  versionId: string,
): MinecraftVersion | undefined {
  return versions.find((version) => version.id === versionId && version.type === 'release')
}

export function sanitizeRuntimeComponent(component: string): string {
  return component.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function javaExecutablePath(runtimeRoot: string, platform: NodeJS.Platform): string {
  return join(runtimeRoot, 'bin', platform === 'win32' ? 'java.exe' : 'java')
}

export function splitIntoBatches<T>(values: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Parti boyutu en az 1 olmalı.')
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size))
  }
  return batches
}

export function javaRuntimePlatformKey(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'windows-arm64'
    if (arch === 'ia32') return 'windows-x86'
    return 'windows-x64'
  }
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return arch === 'ia32' ? 'linux-i386' : 'linux'
}

function collectErrorText(error: unknown, depth = 0): string[] {
  if (depth > 4) return []
  if (error instanceof AggregateError) {
    return [error.name, error.message, ...error.errors.flatMap((inner) => collectErrorText(inner, depth + 1))]
  }

  if (error instanceof Error) {
    const extended = error as Error & {
      code?: unknown
      destination?: unknown
      url?: unknown
      urls?: unknown
    }
    return [
      error.name,
      error.message,
      typeof extended.code === 'string' ? extended.code : '',
      typeof extended.destination === 'string' ? extended.destination : '',
      typeof extended.url === 'string' ? extended.url : '',
      Array.isArray(extended.urls) ? extended.urls.join(', ') : '',
    ]
  }

  return [String(error)]
}

export function describeError(error: unknown): string {
  const summary = collectErrorText(error).filter(Boolean).join(' | ')
  const stack = error instanceof Error ? error.stack : undefined
  return stack && !summary.includes(stack) ? `${summary}\n${stack}` : summary
}

export function isRetryableInstallError(error: unknown): boolean {
  const details = describeError(error)
  return /AggregateError|InvalidZip|Checksum|Validation|fetch failed|ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|UND_ERR|socket|terminated|network|HTTP (?:408|429|5\d\d)/i.test(details)
}

export async function retryInstallOperation<T>(
  operation: (attempt: number) => Promise<T>,
  onRetry: (error: unknown, nextAttempt: number, attempts: number) => Promise<void> | void = () => {},
  attempts = INSTALL_ATTEMPTS,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  }),
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error: unknown) {
      lastError = error
      if (attempt >= attempts || !isRetryableInstallError(error)) throw error
      await onRetry(error, attempt + 1, attempts)
      await wait(RETRY_BASE_DELAY_MS * attempt)
    }
  }
  throw lastError
}

export function errorMessage(error: unknown): string {
  const details = describeError(error)
  if (/için Fabric Loader bulunamadı|resmi sürüm listesinde bulunamadı|profili seçilen Minecraft|sürüm bilgisi .* eşleşmiyor/.test(details)) {
    return error instanceof Error ? error.message : 'Seçilen sürüm için uyumlu profil bulunamadı.'
  }
  if (/InvalidZip|Checksum|Validation/i.test(details)) {
    return 'İndirilen oyun dosyalarından biri doğrulanamadı. Launcher yeniden indirmeyi denedi; bağlantını kontrol edip tekrar Oyna’ya bas.'
  }
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|UND_ERR|socket|terminated|network|HTTP (?:408|429|5\d\d)/i.test(details)) {
    return 'İndirme sunucusuna ulaşılamadı. İnternet bağlantını kontrol edip tekrar Oyna’ya bas.'
  }
  if (/EACCES|EPERM|permission|access denied/i.test(details)) {
    return 'Windows oyun dosyalarına yazmayı engelledi. Launcher’ı ve antivirüs izinlerini kontrol et.'
  }
  if (/java/i.test(details) && /not found|ENOENT|version|exited|çıkış/i.test(details)) {
    return 'Gerekli Java çalışma ortamı hazırlanamadı veya oyun açılırken kapandı.'
  }
  return 'Oyun başlatılamadı. Ayrıntılı hata kaydı oluşturuldu.'
}

export class LauncherService {
  private readonly gameRoot: string
  private readonly runtimeRoot: string
  private readonly logPath: string
  private readonly onProgress: ProgressListener
  private readonly content: ContentService
  private operation: Promise<LaunchResult> | null = null
  private gameProcess: ChildProcess | null = null

  constructor(userDataPath: string, onProgress: ProgressListener) {
    this.gameRoot = join(userDataPath, 'minecraft')
    this.runtimeRoot = join(userDataPath, 'runtime')
    this.logPath = join(userDataPath, 'logs', 'launcher-last.log')
    this.onProgress = onProgress
    this.content = new ContentService(this.gameRoot)
  }

  getLogPath(): string {
    return this.logPath
  }

  getState(): LauncherRuntimeState {
    return {
      busy: this.operation !== null,
      gameRunning: this.gameProcess !== null,
      gameVersion: GAME_VERSION,
      fabricLoader: FABRIC_LOADER_VERSION,
      server: SERVER_HOST,
    }
  }

  async verifyInstallation(versionId = GAME_VERSION, useFabric = true): Promise<{ javaPath: string; version: string }> {
    await mkdir(this.gameRoot, { recursive: true })
    await mkdir(this.runtimeRoot, { recursive: true })
    const version = await this.prepareMinecraft(versionId, useFabric)
    const javaPath = await this.prepareJava(version)
    return { javaPath, version: version.id }
  }

  async getMinecraftVersions(): Promise<MinecraftVersionOption[]> {
    const versionList = await retryInstallOperation(() => getVersionList({ fetch: this.reliableFetch, remote: VERSION_MANIFEST_URL }))
    const releases = versionList.versions.filter((version) => version.type === 'release')
    return Promise.all(releases.map(async (version) => ({
      id: version.id,
      type: version.type,
      releaseTime: version.releaseTime,
      installed: await access(join(this.gameRoot, 'versions', version.id, `${version.id}.json`))
        .then(() => true)
        .catch(() => false),
    })))
  }

  listContent(type: ContentType, settings: LauncherSettings): Promise<InstalledContent[]> {
    return this.content.list(type, settings)
  }

  searchContent(type: ContentType, query: string, settings: LauncherSettings): Promise<ContentProject[]> {
    return this.content.search(type, query, settings)
  }

  installContent(type: ContentType, projectId: string, settings: LauncherSettings): Promise<ContentInstallResult> {
    if (this.operation || this.gameProcess) return Promise.resolve({ ok: false, message: 'İçerik değiştirmek için önce oyunu kapat.' })
    return this.content.install(type, projectId, settings)
  }

  toggleContent(type: ContentType, fileName: string, enabled: boolean, settings: LauncherSettings): Promise<InstalledContent[]> {
    if (this.operation || this.gameProcess) return Promise.reject(new Error('İçerik değiştirmek için önce oyunu kapat.'))
    return this.content.toggle(type, fileName, enabled, settings)
  }

  getContentDirectory(type: ContentType, settings: LauncherSettings): string {
    return this.content.getContentDirectory(type, settings)
  }

  play(settings: LauncherSettings): Promise<LaunchResult> {
    if (this.content.isInstalling()) return Promise.resolve({ ok: false, message: 'İçerik indirmesinin tamamlanmasını bekle.' })
    if (this.operation) {
      return Promise.resolve({ ok: false, message: 'Oyun zaten hazırlanıyor.' })
    }
    if (this.gameProcess) {
      return Promise.resolve({ ok: false, message: 'Minecraft zaten çalışıyor.' })
    }
    if (!settings.nickname) {
      return Promise.resolve({ ok: false, message: 'Geçerli bir oyuncu adı yazmalısın.' })
    }

    this.operation = this.prepareAndLaunch(settings)
    return this.operation.finally(() => {
      this.operation = null
    })
  }

  private emit(stage: LauncherProgress['stage'], message: string, progress: number): void {
    this.onProgress({
      stage,
      message,
      progress: Math.max(0, Math.min(100, Math.round(progress))),
    })
  }

  private async resetLog(settings: LauncherSettings): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true })
    const header = [
      'Kirazium Launcher hata/başlatma kaydı',
      `Tarih: ${new Date().toISOString()}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Minecraft: ${settings.gameVersion}`,
      `Yükleyici: ${settings.useFabric ? 'Fabric' : 'Vanilla'}`,
      `Bellek: ${settings.minMemoryMb}-${settings.maxMemoryMb} MB`,
      '',
    ].join('\n')
    await writeFile(this.logPath, header, 'utf8')
  }

  private async log(message: string): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true })
    await appendFile(this.logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  }

  private async runTaskWithRetry<T>(
    createTask: () => Task<T>,
    stage: LauncherProgress['stage'],
    message: string,
    progressStart: number,
    progressEnd: number,
  ): Promise<T> {
    return retryInstallOperation(
      async (attempt) => {
        await this.log(`${message} (deneme ${attempt}/${INSTALL_ATTEMPTS})`)
        const task = createTask()
        return task.startAndWait(
          this.taskContext(task, stage, message, progressStart, progressEnd),
        )
      },
      async (error, nextAttempt, attempts) => {
        await this.log(`İndirme hatası: ${describeError(error)}`)
        this.emit(stage, `İndirme yeniden deneniyor (${nextAttempt}/${attempts})…`, progressStart)
      },
    )
  }

  private readonly reliableFetch: typeof fetch = async (input, init) => retryInstallOperation(
    async () => {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(input)}`)
      const body = await response.arrayBuffer()
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    },
  )

  private async downloadVerifiedFile(
    url: string,
    destination: string,
    expectedSha1: string | undefined,
    label: string,
  ): Promise<void> {
    const isValid = async (): Promise<boolean> => {
      try {
        const contents = await readFile(destination)
        if (!expectedSha1) return contents.length > 0
        return createHash('sha1').update(contents).digest('hex') === expectedSha1
      } catch {
        return false
      }
    }
    if (await isValid()) return

    await retryInstallOperation(
      async () => {
        const response = await this.reliableFetch(url)
        const contents = Buffer.from(await response.arrayBuffer())
        const actualSha1 = createHash('sha1').update(contents).digest('hex')
        if (expectedSha1 && actualSha1 !== expectedSha1) {
          const mismatch = new Error(`${label} SHA-1 doğrulaması başarısız: ${actualSha1}`)
          mismatch.name = 'ChecksumNotMatchError'
          throw mismatch
        }

        await mkdir(dirname(destination), { recursive: true })
        const temporary = `${destination}.${process.pid}.part`
        await writeFile(temporary, contents)
        await unlink(destination).catch(() => {})
        await rename(temporary, destination)
      },
      async (error, nextAttempt, attempts) => {
        await this.log(`${label} indirme hatası: ${describeError(error)}`)
        this.emit('minecraft', `${label} yeniden deneniyor (${nextAttempt}/${attempts})…`, 60)
      },
    )
  }

  private async installLibrariesInBatches(version: ResolvedVersion): Promise<void> {
    const batches = splitIntoBatches(version.libraries, DOWNLOAD_BATCH_SIZE)
    for (const [index, libraries] of batches.entries()) {
      const from = 36 + (index / batches.length) * 23
      const to = 36 + ((index + 1) / batches.length) * 23
      await this.runTaskWithRetry(
        () => installResolvedLibrariesTask(libraries, this.gameRoot),
        'fabric',
        `Oyun kütüphaneleri indiriliyor (${index + 1}/${batches.length})…`,
        from,
        to,
      )
    }
  }

  private async installAssetsInBatches(version: ResolvedVersion): Promise<void> {
    const folder = MinecraftFolder.from(this.gameRoot)
    const logConfig = version.logging?.client?.file
    if (logConfig?.url) {
      await this.downloadVerifiedFile(
        logConfig.url,
        folder.getLogConfig(logConfig.id),
        logConfig.sha1,
        'Minecraft günlük yapılandırması',
      )
    }

    if (!version.assetIndex?.url) throw new Error('Minecraft asset index bilgisi bulunamadı.')
    const assetIndexPath = folder.getAssetsIndex(version.assets)
    await this.downloadVerifiedFile(
      version.assetIndex.url,
      assetIndexPath,
      version.assetIndex.sha1,
      'Minecraft asset listesi',
    )

    const parsed = JSON.parse(await readFile(assetIndexPath, 'utf8')) as {
      objects?: Record<string, { hash?: unknown; size?: unknown }>
    }
    if (!parsed.objects || typeof parsed.objects !== 'object') {
      throw new Error('Minecraft asset listesi geçersiz.')
    }
    const assets = Object.entries(parsed.objects).map(([name, value]) => {
      if (typeof value.hash !== 'string' || typeof value.size !== 'number') {
        throw new Error(`Geçersiz asset kaydı: ${name}`)
      }
      return { name, hash: value.hash, size: value.size }
    })

    const batches = splitIntoBatches(assets, DOWNLOAD_BATCH_SIZE)
    for (const [index, batch] of batches.entries()) {
      const from = 60 + (index / batches.length) * 13
      const to = 60 + ((index + 1) / batches.length) * 13
      await this.runTaskWithRetry(
        () => installResolvedAssetsTask(batch, folder),
        'minecraft',
        `Minecraft kaynakları indiriliyor (${index + 1}/${batches.length})…`,
        from,
        to,
      )
    }
  }

  private taskContext<T>(
    rootTask: Task<T>,
    stage: LauncherProgress['stage'],
    message: string,
    progressStart: number,
    progressEnd: number,
  ): TaskContext {
    let lastUpdate = 0
    const update = (): void => {
      const now = Date.now()
      if (now - lastUpdate < 120) return
      lastUpdate = now
      const ratio = rootTask.total > 0 ? rootTask.progress / rootTask.total : 0
      this.emit(stage, message, progressStart + ratio * (progressEnd - progressStart))
    }

    return {
      onStart: update,
      onUpdate: update,
      onSucceed: update,
    }
  }

  private async prepareMinecraft(versionId: string, useFabric: boolean): Promise<ResolvedVersion> {
    this.emit('metadata', `Minecraft ${versionId} doğrulanıyor…`, 4)
    const versionList = await retryInstallOperation(() => getVersionList({
      fetch: this.reliableFetch,
      remote: VERSION_MANIFEST_URL,
    }))
    const metadata = selectVersionMetadata(versionList.versions, versionId)
    if (!metadata) throw new Error(`Minecraft ${versionId} resmi sürüm listesinde bulunamadı.`)

    // Repair invalid cached metadata before the installer resolves dependencies.
    const metadataPath = join(this.gameRoot, 'versions', versionId, `${versionId}.json`)
    const metadataHash = (metadata as MinecraftVersion & { sha1?: string }).sha1
    if (!metadataHash || !/^[a-f0-9]{40}$/i.test(metadataHash)) throw new Error('Minecraft sürüm doğrulama özeti bulunamadı.')
    await this.downloadVerifiedFile(metadata.url, metadataPath, metadataHash, 'Minecraft sürüm bilgisi')
    const baseProfile = JSON.parse(await readFile(metadataPath, 'utf8')) as { id?: unknown; inheritsFrom?: unknown }
    if (baseProfile.id !== versionId || baseProfile.inheritsFrom) {
      throw new Error(`Minecraft sürüm bilgisi ${versionId} ile eşleşmiyor.`)
    }

    this.emit('minecraft', 'Minecraft dosyaları hazırlanıyor…', 10)
    await this.runTaskWithRetry(
      () => installVersionTask(metadata, this.gameRoot),
      'minecraft',
      'Minecraft ana dosyaları indiriliyor…',
      10,
      32,
    )

    let resolvedVersion: ResolvedVersion
    if (useFabric) {
      this.emit('fabric', 'Fabric Loader hazırlanıyor…', 34)
      let fabricVersion: string
      if (versionId === GAME_VERSION) {
        fabricVersion = await installFabric({
          minecraftVersion: versionId,
          version: FABRIC_LOADER_VERSION,
          minecraft: this.gameRoot,
          side: 'client',
          fetch: this.reliableFetch,
        })
      } else {
        const loaders = await retryInstallOperation(() => getLoaderArtifactListFor(versionId, {
          fetch: this.reliableFetch,
        }))
        const loader = loaders.find((candidate) => candidate.loader.stable) ?? loaders[0]
        if (!loader) throw new Error(`Minecraft ${versionId} için Fabric Loader bulunamadı. Vanilla seçeneğini kullan.`)
        fabricVersion = await installFabric({
          minecraftVersion: versionId,
          version: loader.loader.version,
          minecraft: this.gameRoot,
          side: 'client',
          fetch: this.reliableFetch,
        })
      }
      const fabricProfile = JSON.parse(await readFile(join(this.gameRoot, 'versions', fabricVersion, `${fabricVersion}.json`), 'utf8')) as { inheritsFrom?: unknown }
      if (fabricProfile.inheritsFrom !== versionId) {
        throw new Error(`Fabric profili seçilen Minecraft ${versionId} sürümüyle eşleşmiyor.`)
      }
      resolvedVersion = await Version.parse(this.gameRoot, fabricVersion)
    } else {
      resolvedVersion = await Version.parse(this.gameRoot, versionId)
    }

    await this.installLibrariesInBatches(resolvedVersion)
    await this.installAssetsInBatches(resolvedVersion)

    return resolvedVersion
  }

  private async verifyJava(javaPath: string, requiredMajor: number): Promise<boolean> {
    try {
      const result = await execFileAsync(javaPath, ['-version'], {
        timeout: 15_000,
        windowsHide: true,
      })
      const output = `${result.stdout}\n${result.stderr}`
      const match = output.match(/version\s+"(?:1\.)?(\d+)/i)
      return match?.[1] !== undefined && Number(match[1]) === requiredMajor
    } catch {
      return false
    }
  }

  private async prepareJava(version: ResolvedVersion): Promise<string> {
    if (!version.javaVersion?.component || !Number.isInteger(version.javaVersion.majorVersion) || version.javaVersion.majorVersion < 8) {
      throw new Error('Minecraft Java sürüm bilgisi geçersiz.')
    }
    const component = sanitizeRuntimeComponent(version.javaVersion.component)
    const destination = join(this.runtimeRoot, `${component}-${version.javaVersion.majorVersion}`)
    const javaPath = javaExecutablePath(destination, process.platform)

    if (await this.verifyJava(javaPath, version.javaVersion.majorVersion)) return javaPath

    this.emit('java', `Java ${version.javaVersion.majorVersion} hazırlanıyor…`, 74)
    const manifest = await this.fetchJavaRuntimeManifest(version.javaVersion.component)
    const entries = Object.entries(manifest.files)
    const fileEntries = entries.filter(([, entry]) => entry.type === 'file')
    const otherEntries = entries.filter(([, entry]) => entry.type !== 'file')
    const batches = splitIntoBatches(fileEntries, DOWNLOAD_BATCH_SIZE)
    for (const [index, batch] of batches.entries()) {
      const from = 75 + (index / batches.length) * 15
      const to = 75 + ((index + 1) / batches.length) * 15
      const files = Object.fromEntries(index === 0 ? [...otherEntries, ...batch] : batch)
      await this.runTaskWithRetry(
        () => installJavaRuntimeTask({
          destination,
          manifest: { ...manifest, files },
        }),
        'java',
        `Java çalışma ortamı indiriliyor (${index + 1}/${batches.length})…`,
        from,
        to,
      )
    }

    if (!await this.verifyJava(javaPath, version.javaVersion.majorVersion)) {
      throw new Error(`Java ${version.javaVersion.majorVersion} doğrulanamadı.`)
    }
    return javaPath
  }

  private async fetchJavaRuntimeManifest(target: string): Promise<JavaRuntimeManifest> {
    const indexResponse = await this.reliableFetch(JAVA_RUNTIME_INDEX_URL)
    const index = await indexResponse.json() as Record<string, Record<string, Array<{
      manifest?: { url?: unknown }
      version?: { name?: unknown; released?: unknown }
    }>>>
    const platformKey = javaRuntimePlatformKey(process.platform, process.arch)
    const runtime = index[platformKey]?.[target]?.[0]
    if (!runtime || typeof runtime.manifest?.url !== 'string') {
      throw new Error(`${platformKey} için ${target} Java çalışma ortamı bulunamadı.`)
    }
    if (typeof runtime.version?.name !== 'string' || typeof runtime.version.released !== 'string') {
      throw new Error(`${target} Java sürüm bilgisi geçersiz.`)
    }

    const manifestResponse = await this.reliableFetch(runtime.manifest.url)
    const detail = await manifestResponse.json() as { files?: unknown }
    if (!detail.files || typeof detail.files !== 'object') {
      throw new Error(`${target} Java dosya listesi geçersiz.`)
    }
    return {
      target,
      version: {
        name: runtime.version.name,
        released: runtime.version.released,
      },
      files: detail.files as JavaRuntimeManifest['files'],
    }
  }

  private watchProcess(process: ChildProcess): void {
    this.gameProcess = process
    process.stdout?.resume()
    process.stderr?.resume()

    const clear = (): void => {
      if (this.gameProcess === process) this.gameProcess = null
      this.emit('idle', 'Minecraft kapandı.', 0)
    }
    process.once('exit', clear)
    process.once('error', clear)
  }

  private async confirmProcessStarted(process: ChildProcess, gameLogPath?: string): Promise<void> {
    let stderr = ''
    const collect = (chunk: Buffer | string): void => {
      if (stderr.length < 12_000) stderr += chunk.toString()
    }
    process.stderr?.on('data', collect)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        process.off('error', onError)
        process.off('exit', onExit)
        process.stderr?.off('data', collect)
        if (error) reject(error)
        else resolve()
      }
      const onError = (error: Error): void => finish(error)
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        const report = async (): Promise<void> => {
          const output = gameLogPath ? await readFile(gameLogPath, 'utf8').catch(() => stderr) : stderr
          const detail = output.trim().slice(-4_000)
          finish(new Error(`Minecraft erken kapandı (çıkış: ${code ?? signal ?? 'bilinmiyor'}).${detail ? `\n${detail}` : ''}`))
        }
        clearTimeout(timer)
        void report()
      }
      const timer = setTimeout(() => {
        if (process.exitCode !== null || process.signalCode !== null) onExit(process.exitCode, process.signalCode)
        else finish()
      }, 10_000)
      process.once('error', onError)
      process.once('exit', onExit)
      if (process.exitCode !== null || process.signalCode !== null) onExit(process.exitCode, process.signalCode)
    })
  }

  private async prepareAndLaunch(settings: LauncherSettings): Promise<LaunchResult> {
    try {
      await this.resetLog(settings)
      await this.log('Hazırlama işlemi başladı.')
      await mkdir(this.gameRoot, { recursive: true })
      await mkdir(this.runtimeRoot, { recursive: true })

      const version = await this.prepareMinecraft(settings.gameVersion, settings.useFabric)
      const javaPath = await this.prepareJava(version)
      const authentication = offline(settings.nickname)
      const instanceRoot = this.content.getInstanceRoot(settings)
      await mkdir(instanceRoot, { recursive: true })
      const joinsKirazium = settings.gameVersion === GAME_VERSION

      this.emit('launching', 'Minecraft başlatılıyor…', 94)
      const detached = settings.closeOnLaunch
      const gameLogPath = join(dirname(this.logPath), 'minecraft-last.log')
      const gameLog = await open(gameLogPath, 'w')
      const process = await launch({
        gamePath: instanceRoot,
        resourcePath: this.gameRoot,
        javaPath,
        version,
        gameProfile: authentication.selectedProfile,
        accessToken: authentication.accessToken,
        userType: 'legacy',
        properties: {},
        launcherName: 'Kirazium Launcher',
        launcherBrand: 'Kirazium',
        minMemory: settings.minMemoryMb,
        maxMemory: settings.maxMemoryMb,
        ...(joinsKirazium ? {
          quickPlayMultiplayer: createQuickPlayMultiplayer(SERVER_HOST, SERVER_PORT),
          server: { ip: SERVER_HOST, port: SERVER_PORT },
        } : {}),
        extraExecOption: {
          cwd: this.gameRoot,
          detached,
          windowsHide: true,
          stdio: ['ignore', gameLog.fd, gameLog.fd],
        },
      }).finally(() => gameLog.close())

      await this.confirmProcessStarted(process, gameLogPath)
      await this.log(`Minecraft işlemi başladı (PID: ${process.pid ?? 'bilinmiyor'}).`)
      if (detached) {
        process.stdout?.destroy()
        process.stderr?.destroy()
        process.unref()
      } else {
        this.watchProcess(process)
      }

      this.emit('running', 'Minecraft açıldı.', 100)
      return { ok: true, ...(process.pid === undefined ? {} : { pid: process.pid }) }
    } catch (error: unknown) {
      console.error('Minecraft başlatma hatası:', error)
      await this.log(`BAŞLATMA HATASI\n${describeError(error)}`).catch(() => {})
      const message = errorMessage(error)
      this.emit('error', message, 0)
      return { ok: false, message }
    }
  }
}

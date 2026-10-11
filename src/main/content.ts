import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  ContentInstallResult,
  ContentProject,
  ContentType,
  InstalledContent,
  LauncherSettings,
} from '../shared/contracts'

const MODRINTH_API = 'https://api.modrinth.com/v2'
const MAX_CONTENT_BYTES = 512 * 1024 * 1024
const PROJECT_ID_PATTERN = /^[A-Za-z0-9]{3,64}$/

interface ModrinthFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes: { sha1?: string; sha512?: string }
}

interface ModrinthVersion {
  id: string
  project_id: string
  game_versions: string[]
  loaders: string[]
  files: ModrinthFile[]
  dependencies?: Array<{
    project_id?: string | null
    version_id?: string | null
    dependency_type?: string
  }>
}

function instanceKey(settings: LauncherSettings): string {
  const version = settings.gameVersion.replace(/[^A-Za-z0-9._-]/g, '_')
  return `${version}-${settings.useFabric ? 'fabric' : 'vanilla'}`
}

function contentFolderName(type: ContentType): string {
  return type === 'mod' ? 'mods' : 'resourcepacks'
}

function expectedExtension(type: ContentType): string {
  return type === 'mod' ? '.jar' : '.zip'
}

function isSafeContentFile(type: ContentType, fileName: string): boolean {
  const extension = expectedExtension(type)
  return basename(fileName) === fileName
    && !/[\0<>:"/\\|?*]/.test(fileName)
    && (fileName.toLowerCase().endsWith(extension) || fileName.toLowerCase().endsWith(`${extension}.disabled`))
}

function toInstalledContent(type: ContentType, fileName: string, resourcePacks: Set<string>): InstalledContent {
  const enabled = type === 'resourcepack'
    ? resourcePacks.has(`file/${fileName}`)
    : !fileName.toLowerCase().endsWith('.disabled')
  const displayName = fileName
    .replace(/\.disabled$/i, '')
    .replace(/\.(jar|zip)$/i, '')
    .replace(/[-_]+/g, ' ')
  return { fileName, displayName, type, enabled }
}

export class ContentService {
  private installing = false
  constructor(private readonly gameRoot: string) {}

  isInstalling(): boolean { return this.installing }

  getInstanceRoot(settings: LauncherSettings): string {
    return join(this.gameRoot, 'instances', instanceKey(settings))
  }

  getContentDirectory(type: ContentType, settings: LauncherSettings): string {
    return join(this.getInstanceRoot(settings), contentFolderName(type))
  }

  async list(type: ContentType, settings: LauncherSettings): Promise<InstalledContent[]> {
    const directory = this.getContentDirectory(type, settings)
    await mkdir(directory, { recursive: true })
    const entries = await readdir(directory, { withFileTypes: true })
    const resourcePacks = type === 'resourcepack' ? await this.readActiveResourcePacks(settings) : new Set<string>()
    return entries
      .filter((entry) => entry.isFile() && isSafeContentFile(type, entry.name))
      .map((entry) => toInstalledContent(type, entry.name, resourcePacks))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'))
  }

  async toggle(
    type: ContentType,
    fileName: string,
    enabled: boolean,
    settings: LauncherSettings,
  ): Promise<InstalledContent[]> {
    if (!isSafeContentFile(type, fileName)) throw new Error('Geçersiz içerik dosyası.')
    if (this.installing) throw new Error('İndirme tamamlanmadan içerik durumu değiştirilemez.')
    const directory = this.getContentDirectory(type, settings)
    await access(join(directory, fileName))
    if (type === 'resourcepack') {
      const active = await this.readActiveResourcePacks(settings)
      const key = `file/${fileName}`
      if (enabled) active.add(key)
      else active.delete(key)
      await this.writeActiveResourcePacks(settings, active)
    } else {
      const currentlyEnabled = !fileName.toLowerCase().endsWith('.disabled')
      if (currentlyEnabled !== enabled) {
        const nextName = enabled ? fileName.replace(/\.disabled$/i, '') : `${fileName}.disabled`
        await rename(join(directory, fileName), join(directory, nextName))
      }
    }
    return this.list(type, settings)
  }

  async search(type: ContentType, query: string, settings: LauncherSettings): Promise<ContentProject[]> {
    const trimmed = query.trim().slice(0, 80)
    const facets: string[][] = [
      [`project_type:${type}`],
      [`versions:${settings.gameVersion}`],
    ]
    if (type === 'mod') facets.push(['categories:fabric'])

    const parameters = new URLSearchParams({
      query: trimmed,
      facets: JSON.stringify(facets),
      index: trimmed ? 'relevance' : 'downloads',
      limit: '16',
    })
    const result = await this.fetchJson(`${MODRINTH_API}/search?${parameters.toString()}`) as {
      hits?: Array<{
        project_id?: unknown
        title?: unknown
        description?: unknown
        author?: unknown
        downloads?: unknown
        project_type?: unknown
        icon_url?: unknown
      }>
    }
    if (!Array.isArray(result.hits)) throw new Error('Modrinth arama sonucu geçersiz.')

    return result.hits.flatMap((hit) => {
      if (typeof hit.project_id !== 'string' || typeof hit.title !== 'string') return []
      return [{
        iconUrl: typeof hit.icon_url === 'string' && /^https:\/\/cdn\.modrinth\.com\//.test(hit.icon_url) ? hit.icon_url : null,
        projectId: hit.project_id,
        title: hit.title,
        description: typeof hit.description === 'string' ? hit.description : '',
        author: typeof hit.author === 'string' ? hit.author : '',
        downloads: typeof hit.downloads === 'number' ? hit.downloads : 0,
        projectType: type,
      }]
    })
  }

  async install(
    type: ContentType,
    projectId: string,
    settings: LauncherSettings,
  ): Promise<ContentInstallResult> {
    if (!PROJECT_ID_PATTERN.test(projectId)) return { ok: false, message: 'Geçersiz proje kimliği.' }
    if (type === 'mod' && !settings.useFabric) {
      return { ok: false, message: 'Mod kurmak için bu profilde Fabric’i etkinleştir.' }
    }

    if (this.installing) return { ok: false, message: 'Başka bir içerik indiriliyor. Tamamlanmasını bekle.' }
    this.installing = true
    settings = { ...settings }
    try {
      const directory = this.getContentDirectory(type, settings)
      await mkdir(directory, { recursive: true })
      const existing: Array<{ fileName: string; version: ModrinthVersion }> = []
      {
        for (const fileName of await readdir(directory)) {
          if (!fileName.toLowerCase().endsWith(expectedExtension(type))) continue
          const hash = createHash('sha1').update(await readFile(join(directory, fileName))).digest('hex')
          try {
            existing.push({ fileName, version: await this.fetchJson(`${MODRINTH_API}/version_file/${hash}?algorithm=sha1`) as ModrinthVersion })
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('HTTP 404')) throw error
          }
        }
      }
      const plan = new Map<string, ModrinthVersion>()
      await this.resolveProject(type, projectId, settings, plan, 0)
      // Keep exact requirements of mods that remain installed in this profile.
      for (const item of type === 'mod' ? existing : []) {
        if (plan.has(item.version.project_id)) continue
        for (const dependency of item.version.dependencies ?? []) {
          if (dependency.dependency_type !== 'required' || !dependency.project_id || !dependency.version_id || !plan.has(dependency.project_id)) continue
          if (plan.get(dependency.project_id)?.id !== dependency.version_id) {
            throw new Error('Bu indirme mevcut bir modun bağımlılığıyla çakışıyor. Önce ilgili modu güncelle veya Yüklüler bölümünden kapat.')
          }
        }
      }
      const staging = join(this.getInstanceRoot(settings), '.content-downloads', `${Date.now()}-${process.pid}`)
      const files: Array<{ projectId: string; file: ModrinthFile }> = []
      for (const version of plan.values()) {
        const file = version.files.find(candidate => candidate.primary) ?? version.files[0]
        if (!file || !isSafeContentFile(type, file.filename) || file.filename.endsWith('.disabled')) throw new Error('Uyumlu indirme dosyası bulunamadı.')
        if (files.some(item => item.file.filename === file.filename)) throw new Error('İçerik dosya adları çakışıyor.')
        await this.downloadFile(file, staging)
        files.push({ projectId: version.project_id, file })
      }
      const backup = join(this.getInstanceRoot(settings), '.content-backups', `${Date.now()}-${process.pid}`)
      const moved: string[] = []
      const committed: string[] = []
      const activePacks = type === 'resourcepack' ? await this.readActiveResourcePacks(settings) : new Set<string>()
      await mkdir(backup, { recursive: true })
      try {
        for (const fileName of await readdir(directory)) {
          if (!files.some(item => item.file.filename === fileName || existing.some(old => old.fileName === fileName && old.version.project_id === item.projectId))) continue
          await rename(join(directory, fileName), join(backup, fileName))
          moved.push(fileName)
        }
        for (const { file } of files) {
          await rename(join(staging, file.filename), join(directory, file.filename))
          committed.push(file.filename)
        }
        if (type === 'resourcepack') {
          for (const old of existing) {
            const replacement = files.find(item => item.projectId === old.version.project_id)
            if (replacement && activePacks.delete(`file/${old.fileName}`)) activePacks.add(`file/${replacement.file.filename}`)
          }
          await this.writeActiveResourcePacks(settings, activePacks)
        }
      } catch (error) {
        for (const fileName of committed) await unlink(join(directory, fileName))
        for (const fileName of moved) await rename(join(backup, fileName), join(directory, fileName))
        throw error
      }
      return { ok: true, message: `${settings.gameVersion} ${settings.useFabric ? 'Fabric' : 'Vanilla'} profiline uyumlu içerik ve bağımlılıkları indirildi.` }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : 'İçerik indirilemedi.' }
    } finally {
      this.installing = false
    }
  }

  private async resolveProject(
    type: ContentType,
    projectId: string,
    settings: LauncherSettings,
    plan: Map<string, ModrinthVersion>,
    depth: number,
    exactVersionId?: string,
  ): Promise<void> {
    const previous = plan.get(projectId)
    if (previous) {
      if (exactVersionId && previous.id !== exactVersionId) throw new Error('Mod bağımlılıkları farklı sürümler gerektiriyor; birlikte kurulamaz.')
      return
    }
    if (depth > 12) throw new Error('İçerik bağımlılık zinciri çok uzun.')

    const parameters = new URLSearchParams({
      game_versions: JSON.stringify([settings.gameVersion]),
      include_changelog: 'false',
    })
    if (type === 'mod') parameters.set('loaders', JSON.stringify(['fabric']))
    const versions = (exactVersionId ? [await this.fetchJson(`${MODRINTH_API}/version/${encodeURIComponent(exactVersionId)}`)] : await this.fetchJson(
      `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${parameters.toString()}`,
    )) as ModrinthVersion[]
    if (!Array.isArray(versions) || !versions.length) throw new Error(`${settings.gameVersion} için uyumlu sürüm bulunamadı.`)
    let lastError: unknown
    for (const version of versions) {
      const savedPlan = new Map(plan)
      try {
        if (version.project_id !== projectId || !version.game_versions?.includes(settings.gameVersion) || (type === 'mod' && !version.loaders?.includes('fabric'))) {
          throw new Error(`${settings.gameVersion} için bu içerik veya bağımlılığı uyumlu değil. Başka bir sürüm seç.`)
        }
        plan.set(projectId, version)

        for (const dependency of type === 'mod' ? version.dependencies ?? [] : []) {
          if (dependency.dependency_type === 'required') {
            let dependencyProject = dependency.project_id
            if (!dependencyProject && dependency.version_id) {
              const detail = await this.fetchJson(`${MODRINTH_API}/version/${encodeURIComponent(dependency.version_id)}`) as ModrinthVersion
              dependencyProject = detail.project_id
            }
            if (!dependencyProject) throw new Error('Gerekli mod bağımlılığının projesi belirlenemedi.')
            await this.resolveProject('mod', dependencyProject, settings, plan, depth + 1, dependency.version_id ?? undefined)
          }
        }
        return
      } catch (error) {
        plan.clear()
        for (const [key, value] of savedPlan) plan.set(key, value)
        if (!(error instanceof Error) || /HTTP|fetch|network/i.test(error.message)) throw error
        lastError = error
      }
    }
    throw lastError
  }

  private async downloadFile(file: ModrinthFile, directory: string): Promise<void> {
    const url = new URL(file.url)
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.modrinth.com') {
      throw new Error('Güvenilmeyen indirme adresi reddedildi.')
    }
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_CONTENT_BYTES) {
      throw new Error('İçerik dosyasının boyutu güvenli sınırın dışında.')
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'KiraziumLauncher/0.4.0 (play.kirazium.com)' },
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`İçerik indirilemedi (HTTP ${response.status}).`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_CONTENT_BYTES || bytes.length !== file.size) throw new Error('İçerik dosyasının boyutu doğrulanamadı.')

    const algorithm = file.hashes.sha512 ? 'sha512' : 'sha1'
    const expected = file.hashes.sha512 ?? file.hashes.sha1
    if (!expected) throw new Error('İçerik dosyasında doğrulama özeti yok.')
    const actual = createHash(algorithm).update(bytes).digest('hex')
    if (actual !== expected) throw new Error('İndirilen içerik doğrulanamadı.')

    await mkdir(directory, { recursive: true })
    const destination = join(directory, file.filename)
    const temporary = `${destination}.${process.pid}.part`
    await writeFile(temporary, bytes)
    await unlink(destination).catch(() => {})
    await rename(temporary, destination)
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'KiraziumLauncher/0.4.0 (play.kirazium.com)' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Modrinth servisine ulaşılamadı (HTTP ${response.status}).`)
    return response.json()
  }

  private async readActiveResourcePacks(settings: LauncherSettings): Promise<Set<string>> {
    try {
      const options = await readFile(join(this.getInstanceRoot(settings), 'options.txt'), 'utf8')
      const line = options.split(/\r?\n/).find((entry) => entry.startsWith('resourcePacks:'))
      if (!line) return new Set()
      const parsed = JSON.parse(line.slice('resourcePacks:'.length)) as unknown
      return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
    } catch {
      return new Set()
    }
  }

  private async writeActiveResourcePacks(settings: LauncherSettings, packs: Set<string>): Promise<void> {
    const instanceRoot = this.getInstanceRoot(settings)
    const optionsPath = join(instanceRoot, 'options.txt')
    await mkdir(instanceRoot, { recursive: true })
    let lines: string[] = []
    try {
      lines = (await readFile(optionsPath, 'utf8')).split(/\r?\n/).filter(Boolean)
    } catch {
      // Minecraft ilk kez açılmadan önce seçenek dosyası bulunmayabilir.
    }
    const value = `resourcePacks:${JSON.stringify([...packs])}`
    const index = lines.findIndex((line) => line.startsWith('resourcePacks:'))
    if (index === -1) lines.push(value)
    else lines[index] = value
    const temporary = `${optionsPath}.${process.pid}.part`
    await writeFile(temporary, `${lines.join('\n')}\n`, 'utf8')
    await rename(temporary, optionsPath)
  }
}

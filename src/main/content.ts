import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
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
  project_id: string
  files: ModrinthFile[]
  dependencies?: Array<{
    project_id?: string | null
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
  constructor(private readonly gameRoot: string) {}

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
    const directory = this.getContentDirectory(type, settings)
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
      }>
    }
    if (!Array.isArray(result.hits)) throw new Error('Modrinth arama sonucu geçersiz.')

    return result.hits.flatMap((hit) => {
      if (typeof hit.project_id !== 'string' || typeof hit.title !== 'string') return []
      return [{
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

    try {
      const installed = new Set<string>()
      await this.installProject(type, projectId, settings, installed, 0)
      return { ok: true, message: 'İçerik ve gerekli bağımlılıkları indirildi.' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : 'İçerik indirilemedi.' }
    }
  }

  private async installProject(
    type: ContentType,
    projectId: string,
    settings: LauncherSettings,
    installed: Set<string>,
    depth: number,
  ): Promise<void> {
    if (installed.has(projectId)) return
    if (depth > 12) throw new Error('İçerik bağımlılık zinciri çok uzun.')
    installed.add(projectId)

    const parameters = new URLSearchParams({
      game_versions: JSON.stringify([settings.gameVersion]),
      include_changelog: 'false',
    })
    if (type === 'mod') parameters.set('loaders', JSON.stringify(['fabric']))
    const versions = await this.fetchJson(
      `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${parameters.toString()}`,
    ) as ModrinthVersion[]
    const version = Array.isArray(versions) ? versions[0] : undefined
    if (!version) throw new Error(`${settings.gameVersion} için uyumlu sürüm bulunamadı.`)

    for (const dependency of type === 'mod' ? version.dependencies ?? [] : []) {
      if (dependency.dependency_type === 'required' && typeof dependency.project_id === 'string') {
        await this.installProject('mod', dependency.project_id, settings, installed, depth + 1)
      }
    }

    const file = version.files.find((candidate) => candidate.primary) ?? version.files[0]
    if (!file || !isSafeContentFile(type, file.filename)) throw new Error('Uyumlu indirme dosyası bulunamadı.')
    await this.downloadFile(file, this.getContentDirectory(type, settings))
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
    if (bytes.length > MAX_CONTENT_BYTES) throw new Error('İçerik dosyası çok büyük.')

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

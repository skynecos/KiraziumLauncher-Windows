export interface LauncherSettings {
  nickname: string
  minMemoryMb: number
  maxMemoryMb: number
  closeOnLaunch: boolean
  gameVersion: string
  useFabric: boolean
}

export type ContentType = 'mod' | 'resourcepack'

export interface MinecraftVersionOption {
  id: string
  type: string
  releaseTime: string
  installed: boolean
}

export interface InstalledContent {
  fileName: string
  displayName: string
  type: ContentType
  enabled: boolean
}

export interface ContentProject {
  iconUrl: string | null
  projectId: string
  title: string
  description: string
  author: string
  downloads: number
  projectType: ContentType
}

export interface ContentInstallResult {
  ok: boolean
  message: string
}

export interface LauncherInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  arch: string
}

export interface WindowState {
  maximized: boolean
}

export type LauncherStage =
  | 'idle'
  | 'metadata'
  | 'minecraft'
  | 'fabric'
  | 'java'
  | 'launching'
  | 'running'
  | 'error'

export interface LauncherProgress {
  stage: LauncherStage
  message: string
  progress: number
}

export interface LauncherRuntimeState {
  busy: boolean
  gameRunning: boolean
  gameVersion: string
  fabricLoader: string
  server: string
}

export interface LaunchResult {
  ok: boolean
  pid?: number
  message?: string
}

export interface KiraziumApi {
  getLauncherInfo: () => Promise<LauncherInfo>
  getLauncherState: () => Promise<LauncherRuntimeState>
  getSettings: () => Promise<LauncherSettings>
  saveSettings: (settings: LauncherSettings) => Promise<LauncherSettings>
  launchGame: (settings: LauncherSettings) => Promise<LaunchResult>
  getMinecraftVersions: () => Promise<MinecraftVersionOption[]>
  getInstalledContent: (type: ContentType, settings: LauncherSettings) => Promise<InstalledContent[]>
  searchContent: (type: ContentType, query: string, settings: LauncherSettings) => Promise<ContentProject[]>
  installContent: (type: ContentType, projectId: string, settings: LauncherSettings) => Promise<ContentInstallResult>
  setContentEnabled: (type: ContentType, fileName: string, enabled: boolean, settings: LauncherSettings) => Promise<InstalledContent[]>
  openContentFolder: (type: ContentType, settings: LauncherSettings) => Promise<void>
  openLauncherLog: () => Promise<void>
  onLauncherProgress: (callback: (progress: LauncherProgress) => void) => () => void
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<WindowState>
  closeWindow: () => Promise<void>
}

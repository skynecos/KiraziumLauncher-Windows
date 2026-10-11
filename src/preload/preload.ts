import { contextBridge, ipcRenderer } from 'electron'
import type { ContentType, KiraziumApi, LauncherProgress, LauncherSettings } from '../shared/contracts'

const api: KiraziumApi = Object.freeze({
  onMicrosoftCode: (callback: (code: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, code: string): void => callback(code)
    ipcRenderer.on('account:code', listener)
    return () => ipcRenderer.removeListener('account:code', listener)
  },
  getAccount: () => ipcRenderer.invoke('account:read'),
  loginMicrosoft: () => ipcRenderer.invoke('account:login'),
  logoutAccount: () => ipcRenderer.invoke('account:logout'),
  getLauncherInfo: () => ipcRenderer.invoke('launcher:get-info'),
  getLauncherState: () => ipcRenderer.invoke('launcher:get-state'),
  getSettings: () => ipcRenderer.invoke('settings:read'),
  saveSettings: (settings: LauncherSettings) => ipcRenderer.invoke('settings:save', settings),
  launchGame: (settings: LauncherSettings) => ipcRenderer.invoke('launcher:play', settings),
  getMinecraftVersions: () => ipcRenderer.invoke('versions:list'),
  getInstalledContent: (type: ContentType, settings: LauncherSettings) => ipcRenderer.invoke('content:list', type, settings),
  searchContent: (type: ContentType, query: string, settings: LauncherSettings) => ipcRenderer.invoke('content:search', type, query, settings),
  installContent: (type: ContentType, projectId: string, settings: LauncherSettings) => ipcRenderer.invoke('content:install', type, projectId, settings),
  setContentEnabled: (type: ContentType, fileName: string, enabled: boolean, settings: LauncherSettings) => ipcRenderer.invoke('content:toggle', type, fileName, enabled, settings),
  openContentFolder: (type: ContentType, settings: LauncherSettings) => ipcRenderer.invoke('content:open-folder', type, settings),
  openLauncherLog: () => ipcRenderer.invoke('launcher:open-log'),
  onLauncherProgress: (callback: (progress: LauncherProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: LauncherProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('launcher:progress', listener)
    return () => ipcRenderer.removeListener('launcher:progress', listener)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
})

contextBridge.exposeInMainWorld('kirazium', api)

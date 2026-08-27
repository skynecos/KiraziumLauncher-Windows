import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type { LauncherInfo } from '../shared/contracts'
import type { ContentType } from '../shared/contracts'
import { LauncherService } from './launcher'
import { normalizeSettings, readSettings, saveSettings } from './settings'

const IPC = Object.freeze({
  launcherInfo: 'launcher:get-info',
  launcherState: 'launcher:get-state',
  launcherPlay: 'launcher:play',
  launcherOpenLog: 'launcher:open-log',
  launcherProgress: 'launcher:progress',
  settingsRead: 'settings:read',
  settingsSave: 'settings:save',
  versionsList: 'versions:list',
  contentList: 'content:list',
  contentSearch: 'content:search',
  contentInstall: 'content:install',
  contentToggle: 'content:toggle',
  contentOpenFolder: 'content:open-folder',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
})

let mainWindow: BrowserWindow | null = null
let launcherService: LauncherService | null = null

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url
  return typeof senderUrl === 'string' && senderUrl.startsWith('file://')
}

function requireTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) throw new Error('Güvenilmeyen IPC isteği reddedildi.')
}

function requireContentType(value: unknown): ContentType {
  if (value === 'mod' || value === 'resourcepack') return value
  throw new Error('Geçersiz içerik türü.')
}

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Geçersiz ${label}.`)
  return value
}

function registerIpcHandlers(service: LauncherService): void {
  ipcMain.handle(IPC.launcherInfo, (event): LauncherInfo => {
    requireTrustedSender(event)
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    }
  })

  ipcMain.handle(IPC.launcherState, (event) => {
    requireTrustedSender(event)
    return service.getState()
  })

  ipcMain.handle(IPC.launcherPlay, async (event, value: unknown) => {
    requireTrustedSender(event)
    const settings = normalizeSettings(value)
    const result = await service.play(settings)
    if (result.ok && settings.closeOnLaunch) {
      setTimeout(() => app.quit(), 500)
    }
    return result
  })

  ipcMain.handle(IPC.launcherOpenLog, (event) => {
    requireTrustedSender(event)
    shell.showItemInFolder(service.getLogPath())
  })

  ipcMain.handle(IPC.settingsRead, async (event) => {
    requireTrustedSender(event)
    return readSettings(app.getPath('userData'))
  })

  ipcMain.handle(IPC.settingsSave, async (event, value: unknown) => {
    requireTrustedSender(event)
    return saveSettings(app.getPath('userData'), value)
  })

  ipcMain.handle(IPC.versionsList, async (event) => {
    requireTrustedSender(event)
    return service.getMinecraftVersions()
  })

  ipcMain.handle(IPC.contentList, async (event, rawType: unknown, rawSettings: unknown) => {
    requireTrustedSender(event)
    return service.listContent(requireContentType(rawType), normalizeSettings(rawSettings))
  })

  ipcMain.handle(IPC.contentSearch, async (event, rawType: unknown, rawQuery: unknown, rawSettings: unknown) => {
    requireTrustedSender(event)
    return service.searchContent(
      requireContentType(rawType),
      requireText(rawQuery, 'arama', 80),
      normalizeSettings(rawSettings),
    )
  })

  ipcMain.handle(IPC.contentInstall, async (event, rawType: unknown, rawProjectId: unknown, rawSettings: unknown) => {
    requireTrustedSender(event)
    return service.installContent(
      requireContentType(rawType),
      requireText(rawProjectId, 'proje kimliği', 64),
      normalizeSettings(rawSettings),
    )
  })

  ipcMain.handle(IPC.contentToggle, async (event, rawType: unknown, rawFileName: unknown, rawEnabled: unknown, rawSettings: unknown) => {
    requireTrustedSender(event)
    if (typeof rawEnabled !== 'boolean') throw new Error('Geçersiz etkinlik değeri.')
    return service.toggleContent(
      requireContentType(rawType),
      requireText(rawFileName, 'dosya adı', 255),
      rawEnabled,
      normalizeSettings(rawSettings),
    )
  })

  ipcMain.handle(IPC.contentOpenFolder, async (event, rawType: unknown, rawSettings: unknown) => {
    requireTrustedSender(event)
    const type = requireContentType(rawType)
    const settings = normalizeSettings(rawSettings)
    await service.listContent(type, settings)
    await shell.openPath(service.getContentDirectory(type, settings))
  })

  ipcMain.handle(IPC.windowMinimize, (event) => {
    requireTrustedSender(event)
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    requireTrustedSender(event)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { maximized: false }

    if (window.isMaximized()) window.unmaximize()
    else window.maximize()

    return { maximized: window.isMaximized() }
  })

  ipcMain.handle(IPC.windowClose, (event) => {
    requireTrustedSender(event)
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#111015',
    title: 'Kirazium Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'))
  return window
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    launcherService = new LauncherService(app.getPath('userData'), (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.launcherProgress, progress)
      }
    })
    registerIpcHandlers(launcherService)
    mainWindow = createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  }).catch((error: unknown) => {
    console.error('Kirazium Launcher başlatılamadı:', error)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

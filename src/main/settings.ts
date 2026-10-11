import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LauncherSettings } from '../shared/contracts'

export const DEFAULT_SETTINGS: LauncherSettings = Object.freeze({
  nickname: '',
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  closeOnLaunch: true,
  gameVersion: '26.1.2',
  useFabric: true,
})

const NICKNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/
const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/

function normalizeMemory(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  return Math.min(32_768, Math.max(1_024, value))
}

export function normalizeSettings(value: unknown): LauncherSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS }

  const candidate = value as Partial<LauncherSettings>
  const nickname = typeof candidate.nickname === 'string'
    ? candidate.nickname.trim()
    : ''
  const minMemoryMb = normalizeMemory(candidate.minMemoryMb, DEFAULT_SETTINGS.minMemoryMb)
  const requestedMax = normalizeMemory(candidate.maxMemoryMb, DEFAULT_SETTINGS.maxMemoryMb)

  return {
    nickname: NICKNAME_PATTERN.test(nickname) ? nickname : '',
    minMemoryMb,
    maxMemoryMb: Math.max(minMemoryMb, requestedMax),
    closeOnLaunch: typeof candidate.closeOnLaunch === 'boolean'
      ? candidate.closeOnLaunch
      : DEFAULT_SETTINGS.closeOnLaunch,
    gameVersion: typeof candidate.gameVersion === 'string' && VERSION_PATTERN.test(candidate.gameVersion)
      ? candidate.gameVersion
      : DEFAULT_SETTINGS.gameVersion,
    useFabric: typeof candidate.useFabric === 'boolean'
      ? candidate.useFabric
      : DEFAULT_SETTINGS.useFabric,
  }
}

function settingsPath(userDataPath: string): string {
  return join(userDataPath, 'settings.json')
}

export async function readSettings(userDataPath: string): Promise<LauncherSettings> {
  try {
    const contents = await readFile(settingsPath(userDataPath), 'utf8')
    return normalizeSettings(JSON.parse(contents))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

const pendingWrites = new Map<string, Promise<LauncherSettings>>()

export function saveSettings(
  userDataPath: string,
  value: unknown,
): Promise<LauncherSettings> {
  const settings = normalizeSettings(value)
  const previous = pendingWrites.get(userDataPath) ?? Promise.resolve(settings)
  const operation = previous.catch(() => settings).then(() => writeSettings(userDataPath, settings))
  pendingWrites.set(userDataPath, operation)
  return operation.finally(() => {
    if (pendingWrites.get(userDataPath) === operation) pendingWrites.delete(userDataPath)
  })
}

async function writeSettings(userDataPath: string, settings: LauncherSettings): Promise<LauncherSettings> {
  await mkdir(userDataPath, { recursive: true })

  const destination = settingsPath(userDataPath)
  const temporary = join(userDataPath, `settings.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporary, destination)

  return settings
}

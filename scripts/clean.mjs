import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')

for (const directory of ['dist', 'release']) {
  const target = resolve(projectRoot, directory)
  if (!target.startsWith(`${projectRoot}/`) && !target.startsWith(`${projectRoot}\\`)) {
    throw new Error(`Güvenli olmayan temizleme hedefi: ${target}`)
  }
  await rm(target, { recursive: true, force: true })
}

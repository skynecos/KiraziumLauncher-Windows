import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const source = resolve(projectRoot, 'src', 'renderer')
const destination = resolve(projectRoot, 'dist', 'renderer')

await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })

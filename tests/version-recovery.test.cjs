const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { LauncherService } = require('../dist/main/launcher.js')

test('bozuk önbelleği onarır ve intermediary 0.0.0 olsa da resmi Fabric profilini kullanır', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-recovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new LauncherService(root, () => {})
  const base = JSON.stringify({ id: '26.2', mainClass: 'net.minecraft.client.main.Main', libraries: [], arguments: { game: [], jvm: [] }, javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 } })
  const hash = createHash('sha1').update(base).digest('hex')
  const directory = join(root, 'minecraft/versions/26.2')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, '26.2.json'), '{broken')
  const requests = []
  service.reliableFetch = async url => {
    requests.push(String(url))
    if (String(url).endsWith('version_manifest_v2.json')) return Response.json({ versions: [{ id: '26.2', type: 'release', url: 'https://example.test/base', sha1: hash }] })
    if (String(url) === 'https://example.test/base') return new Response(base)
    if (String(url).endsWith('/loader/26.2')) return Response.json([{ loader: { version: '0.19.5', stable: true }, intermediary: { version: '0.0.0' } }])
    if (String(url).endsWith('/26.2/0.19.5/profile/json')) return Response.json({ id: 'fabric', inheritsFrom: '26.2', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', libraries: [], arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] } })
    throw new Error('Unexpected URL ' + url)
  }
  service.runTaskWithRetry = async () => {}
  service.installLibrariesInBatches = async () => {}
  service.installAssetsInBatches = async () => {}
  const version = await service.prepareMinecraft('26.2', true)
  assert.equal(version.minecraftVersion, '26.2')
  assert.equal(await readFile(join(directory, '26.2.json'), 'utf8'), base)
  assert.ok(requests.some(u => u.endsWith('/26.2/0.19.5/profile/json')))
  assert.ok(!requests.some(u => u.includes('/loader/0.0.0')))
})

test('2.5 saniyeden sonra kapanan Java işlemini başarılı saymaz', async () => {
  const service = new LauncherService(tmpdir(), () => {})
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{console.error("startup regression");process.exit(1)},3500)'], { windowsHide: true })
  try { await assert.rejects(service.confirmProcessStarted(child), /startup regression/) }
  finally { child.kill() }
})

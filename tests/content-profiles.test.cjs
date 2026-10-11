const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readFile, readdir, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { ContentService } = require('../dist/main/content.js')
const settings = { gameVersion: '26.1', useFabric: true }
const version = (project, id, filename, dependencies = []) => ({ id, project_id: project, game_versions: ['26.1'], loaders: ['fabric'], dependencies, files: [{ filename, primary: true }] })

test('Iris tam Sodium bağımlılığını indirir ve eski JARı yedekler; diğer profil korunur', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-profiles-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ContentService(root)
  const directory = service.getContentDirectory('mod', settings)
  const other = service.getContentDirectory('mod', { ...settings, gameVersion: '26.2' })
  await mkdir(directory, { recursive: true }); await mkdir(other, { recursive: true })
  await writeFile(join(directory, 'sodium-old.jar'), 'old')
  await writeFile(join(other, 'sodium-other.jar'), 'other')
  const sodium = version('sodium', 'sodium09', 'sodium-new.jar')
  const iris = version('iris', 'irisnew', 'iris.jar', [{ dependency_type: 'required', project_id: 'sodium', version_id: 'sodium09' }])
  service.fetchJson = async url => {
    if (url.includes('/version_file/')) return version('sodium', 'sodium08', 'sodium-old.jar')
    if (url.includes('/project/iris/')) return [iris]
    if (url.endsWith('/version/sodium09')) return sodium
    throw new Error('Unexpected URL ' + url)
  }
  service.downloadFile = async (file, directory) => { await mkdir(directory, { recursive: true }); await writeFile(join(directory, file.filename), 'new') }
  assert.equal((await service.install('mod', 'iris', settings)).ok, true)
  assert.deepEqual((await readdir(directory)).sort(), ['iris.jar', 'sodium-new.jar'])
  assert.equal(await readFile(join(other, 'sodium-other.jar'), 'utf8'), 'other')
  const backups = await readdir(join(service.getInstanceRoot(settings), '.content-backups'))
  assert.equal(await readFile(join(service.getInstanceRoot(settings), '.content-backups', backups[0], 'sodium-old.jar'), 'utf8'), 'old')
})

test('uyumsuz bağımlılık planını hiçbir mod dosyasını değiştirmeden reddeder', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-conflict-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ContentService(root)
  const iris = version('iris', 'irisnew', 'iris.jar', [{ dependency_type: 'required', project_id: 'sodium', version_id: 'sodium09' }])
  const sodium = { ...version('sodium', 'sodium09', 'sodium.jar'), game_versions: ['26.2'] }
  service.fetchJson = async url => url.includes('/project/iris/') ? [iris] : sodium
  service.downloadFile = async () => { throw new Error('Download must not start') }
  const result = await service.install('mod', 'iris', settings)
  assert.equal(result.ok, false)
  assert.match(result.message, /uyumlu değil/)
  assert.deepEqual(await readdir(service.getContentDirectory('mod', settings)), [])
})

test('kaynak paketinin etkinliği sürüm ve yükleyici profilleri arasında taşınmaz', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-packs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ContentService(root)
  const directory = service.getContentDirectory('resourcepack', settings)
  await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'pack.zip'), 'pack')
  await service.toggle('resourcepack', 'pack.zip', true, settings)
  for (const profile of [{ ...settings, gameVersion: '26.2' }, { ...settings, useFabric: false }]) assert.deepEqual(await service.list('resourcepack', profile), [])
})

test('en yeni modun bağımlılığı uyumsuzsa önceki uyumlu sürümü seçer', async () => {
  const service = new ContentService(tmpdir())
  const newer = version('iris', 'new', 'new.jar', [{ dependency_type: 'required', project_id: 'sodium', version_id: 'sodium09' }])
  const older = version('iris', 'old', 'old.jar', [{ dependency_type: 'required', project_id: 'sodium', version_id: 'sodium08' }])
  service.fetchJson = async url => {
    if (url.includes('/project/iris/')) return [newer, older]
    if (url.endsWith('sodium09')) return { ...version('sodium', 'sodium09', '09.jar'), game_versions: ['26.1.2'] }
    if (url.endsWith('sodium08')) return version('sodium', 'sodium08', '08.jar')
    throw new Error(url)
  }
  const plan = new Map()
  await service.resolveProject('mod', 'iris', settings, plan, 0)
  assert.equal(plan.get('iris').id, 'old')
  assert.equal(plan.get('sodium').id, 'sodium08')
})

test('kaynak paketi güncellemesi eski dosyayı yedekler ve etkinliği yeni dosyaya taşır', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-pack-update-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ContentService(root)
  const directory = service.getContentDirectory('resourcepack', settings)
  await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'old.zip'), 'old')
  await service.toggle('resourcepack', 'old.zip', true, settings)
  service.fetchJson = async url => url.includes('/version_file/') ? version('pack', 'old', 'old.zip') : [version('pack', 'new', 'new.zip')]
  service.downloadFile = async (file, directory) => { await mkdir(directory, { recursive: true }); await writeFile(join(directory, file.filename), 'new') }
  assert.equal((await service.install('resourcepack', 'pack', settings)).ok, true)
  const items = await service.list('resourcepack', settings)
  assert.equal(items.length, 1); assert.equal(items[0].fileName, 'new.zip'); assert.equal(items[0].enabled, true)
})

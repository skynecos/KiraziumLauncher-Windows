const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { ContentService } = require('../dist/main/content.js')

const settings = {
  nickname: 'Neco4242',
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  closeOnLaunch: true,
  gameVersion: '26.1.2',
  useFabric: true,
}

test('modları dosya uzantısını güvenli biçimde değiştirerek kapatır', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-content-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ContentService(root)
  const directory = service.getContentDirectory('mod', settings)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'sodium.jar'), 'test')

  const disabled = await service.toggle('mod', 'sodium.jar', false, settings)
  assert.equal(disabled[0].fileName, 'sodium.jar.disabled')
  assert.equal(disabled[0].enabled, false)
})

test('kaynak paketini options.txt üzerinden etkinleştirir', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-content-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ContentService(root)
  const directory = service.getContentDirectory('resourcepack', settings)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'kirazium.zip'), 'test')

  const enabled = await service.toggle('resourcepack', 'kirazium.zip', true, settings)
  assert.equal(enabled[0].enabled, true)
  const options = await readFile(join(service.getInstanceRoot(settings), 'options.txt'), 'utf8')
  assert.match(options, /file\/kirazium\.zip/)
})

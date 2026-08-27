const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DEFAULT_SETTINGS, normalizeSettings } = require('../dist/main/settings.js')

test('geçersiz ayarlar güvenli varsayılanlara döner', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
})

test('oyuncu adı Minecraft kurallarına göre doğrulanır', () => {
  assert.equal(normalizeSettings({ nickname: 'Neco_16' }).nickname, 'Neco_16')
  assert.equal(normalizeSettings({ nickname: 'a b' }).nickname, '')
  assert.equal(normalizeSettings({ nickname: '../dosya' }).nickname, '')
})

test('bellek sınırlandırılır ve maksimum değer minimumdan düşük kalmaz', () => {
  const normalized = normalizeSettings({
    minMemoryMb: 8192,
    maxMemoryMb: 1024,
  })

  assert.equal(normalized.minMemoryMb, 8192)
  assert.equal(normalized.maxMemoryMb, 8192)
  assert.equal(normalizeSettings({ maxMemoryMb: 999999 }).maxMemoryMb, 32768)
})

test('sürüm ve Fabric profili güvenli biçimde kaydedilir', () => {
  const custom = normalizeSettings({ gameVersion: '1.20.1', useFabric: false })
  assert.equal(custom.gameVersion, '1.20.1')
  assert.equal(custom.useFabric, false)
  assert.equal(normalizeSettings({ gameVersion: '../tehlikeli' }).gameVersion, '26.1.2')
})

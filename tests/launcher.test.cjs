const assert = require('node:assert/strict')
const { test } = require('node:test')
const { join } = require('node:path')
const {
  GAME_VERSION,
  SERVER_HOST,
  describeError,
  errorMessage,
  isRetryableInstallError,
  javaExecutablePath,
  javaRuntimePlatformKey,
  retryInstallOperation,
  sanitizeRuntimeComponent,
  selectVersionMetadata,
  splitIntoBatches,
} = require('../dist/main/launcher.js')

test('yalnızca istenen resmi Minecraft sürümünü seçer', () => {
  const versions = [
    { id: GAME_VERSION, type: 'snapshot' },
    { id: GAME_VERSION, type: 'release' },
    { id: '26.2', type: 'release' },
  ]

  assert.equal(selectVersionMetadata(versions, GAME_VERSION), versions[1])
  assert.equal(selectVersionMetadata(versions, 'yok'), undefined)
})

test('Java çalışma zamanı bileşeni dizin dışına çıkamaz', () => {
  assert.equal(sanitizeRuntimeComponent('../java runtime'), '.._java_runtime')
})

test('Java çalıştırılabilir dosyası platforma göre seçilir', () => {
  assert.equal(javaExecutablePath('/runtime', 'win32'), join('/runtime', 'bin', 'java.exe'))
  assert.equal(javaExecutablePath('/runtime', 'linux'), join('/runtime', 'bin', 'java'))
})

test('Mojang Java manifest platformu Windows mimarisine göre seçilir', () => {
  assert.equal(javaRuntimePlatformKey('win32', 'x64'), 'windows-x64')
  assert.equal(javaRuntimePlatformKey('win32', 'arm64'), 'windows-arm64')
  assert.equal(javaRuntimePlatformKey('win32', 'ia32'), 'windows-x86')
})

test('Kirazium sabitleri doğru sunucuyu ve sürümü kullanır', () => {
  assert.equal(GAME_VERSION, '26.1.2')
  assert.equal(SERVER_HOST, 'play.kirazium.com')
})

test('iç içe indirme hatalarını ayrıntılı olarak çözer', () => {
  const checksum = new Error('sha1 checksum not match')
  checksum.name = 'ChecksumNotMatchError'
  const error = new AggregateError([checksum], '')

  assert.match(describeError(error), /ChecksumNotMatchError/)
  assert.equal(isRetryableInstallError(error), true)
  assert.match(errorMessage(error), /doğrulanamadı/)
})

test('geçici indirme hatasını yeniden deneyip başarıyla tamamlar', async () => {
  let calls = 0
  const retries = []
  const result = await retryInstallOperation(
    async () => {
      calls += 1
      if (calls < 3) throw new Error('fetch failed: ECONNRESET')
      return 'tamam'
    },
    (_error, nextAttempt) => {
      retries.push(nextAttempt)
    },
    4,
    async () => {},
  )

  assert.equal(result, 'tamam')
  assert.equal(calls, 3)
  assert.deepEqual(retries, [2, 3])
})

test('kalıcı kurulum hatasını yeniden denemez', async () => {
  let calls = 0
  await assert.rejects(
    retryInstallOperation(
      async () => {
        calls += 1
        throw new Error('Desteklenmeyen sürüm biçimi')
      },
      () => {},
      4,
      async () => {},
    ),
    /Desteklenmeyen/,
  )
  assert.equal(calls, 1)
})

test('toplu indirmeleri güvenli sayıda dosyaya böler', () => {
  assert.deepEqual(splitIntoBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.throws(() => splitIntoBatches([1], 0), /en az 1/)
})

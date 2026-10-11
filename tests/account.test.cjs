const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
const { AccountService } = require('../dist/main/account.js')

function vault() {
  const key = randomBytes(32)
  return { isEncryptionAvailable: () => true,
    encryptString: text => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]) },
    decryptString: bytes => { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12)); decipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString() }
  }
}
function provider(t, ownsGame = true) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('/user/authenticate')) assert.equal(JSON.parse(options.body).Properties.RpsTicket, 'oauth-test-token')
    if (String(url).includes('xboxlive.com')) return Response.json({ Token: 'xbox-token', DisplayClaims: { xui: [{ uhs: 'userhash' }] } })
    if (String(url).includes('login_with_xbox')) return Response.json({ access_token: 'minecraft-test-token', expires_in: 3600 })
    if (String(url).includes('entitlements')) return Response.json({ items: ownsGame ? [{ name: 'game_minecraft' }] : [] })
    if (String(url).includes('/minecraft/profile')) return Response.json({ id: '0123456789abcdef0123456789abcdef', name: 'TestPlayer', skins: [], capes: [] })
    throw new Error('Unexpected provider URL')
  })
}
test('lisanslı Microsoft profili doğrulanır; tokenlar renderer görünümünde ve diskte düz metin bulunmaz', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-account-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  provider(t)
  const storage = vault()
  const service = new AccountService(root, '00000000402b5328', storage)
  await service.accept('oauth-test-token', 'refresh-test-token')
  const view = service.view()
  assert.equal(view.name, 'TestPlayer'); assert.equal(view.microsoft, true)
  assert.equal(JSON.stringify(view).includes('token'), false)
  const bytes = await readFile(join(root, 'microsoft-account.bin'))
  assert.equal(bytes.includes(Buffer.from('refresh-test-token')), false)
  const restored = new AccountService(root, '00000000402b5328', storage)
  await restored.restore(); assert.equal(restored.view().name, 'TestPlayer')
  assert.equal((await service.credentials()).accessToken, 'minecraft-test-token')
  await service.logout(); assert.equal(service.view().microsoft, false)
  assert.equal(await service.credentials(), null)
})
test('Java lisansı olmayan hesap çevrimiçi oyun oturumu oluşturamaz', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kirazium-no-license-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  provider(t, false)
  const service = new AccountService(root, '00000000402b5328', vault())
  await assert.rejects(service.accept('oauth-test-token', 'refresh-test-token'), /Java lisansı/)
  assert.equal(service.view().microsoft, false)
  await assert.rejects(readFile(join(root, 'microsoft-account.bin')), { code: 'ENOENT' })
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')

test('modlar ve kaynak paketleri ayrı sayfa yerine ana ekran HUD içinde yönetilir', async () => {
  const html = await readFile(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8')

  assert.match(html, /id="content-hud-dock"/)
  assert.match(html, /data-content-hud="mod"/)
  assert.match(html, /data-content-hud="resourcepack"/)
  assert.match(html, /data-hud-mode="discover"/)
  assert.match(html, /data-hud-mode="installed"/)
  assert.doesNotMatch(html, /id="market-view"/)
  assert.doesNotMatch(html, /id="content-view"/)
})

test('mağaza şimdilik görünüm veya bağlantı açmaz', async () => {
  const html = await readFile(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8')
  const storeButton = html.match(/<button id="store-button"[^>]*>/)?.[0]

  assert.ok(storeButton)
  assert.doesNotMatch(storeButton, /data-view=/)
  assert.doesNotMatch(storeButton, /href=/)
})

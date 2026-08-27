const $ = (selector) => document.querySelector(selector)
const nicknameInput = $('#nickname')
const memoryRange = $('#memory-range')
const memoryValue = $('#memory-value')
const settingsMemoryValue = $('#settings-memory-value')
const closeOnLaunch = $('#close-on-launch')
const playButton = $('#play-button')
const playLabel = $('#play-label')
const launchProgress = $('#launch-progress')
const progressMessage = $('#progress-message')
const progressValue = $('#progress-value')
const progressBar = $('#progress-bar')
const errorPanel = $('#error-panel')
const errorMessage = $('#error-message')
const toast = $('#game-message')
const versionSelect = $('#version-select')
const fabricEnabled = $('#fabric-enabled')
const versionState = $('#version-install-state')
const selectedVersionLabel = $('#selected-version-label')
const marketResults = $('#market-results')
const installedContent = $('#installed-content')
const contentHudPanel = $('#content-hud-panel')
const contentHudTitle = $('#content-hud-title')
const contentHudProfile = $('#content-hud-profile')
const contentSearch = $('#content-search')

let settings = {
  nickname: '',
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  closeOnLaunch: true,
  gameVersion: '26.1.2',
  useFabric: true,
}
let versions = []
let hudType = 'mod'
let hudMode = 'discover'
let toastTimer

function profileLabel() {
  return `${settings.gameVersion} • ${settings.useFabric ? 'Fabric' : 'Vanilla'}`
}

function refreshProfileLabels() {
  const label = profileLabel()
  selectedVersionLabel.textContent = label
  contentHudProfile.textContent = label
  const selected = versions.find((version) => version.id === settings.gameVersion)
  versionState.textContent = selected?.installed
    ? 'Bu sürüm daha önce indirildi.'
    : 'Oyna dediğinde sürüm otomatik indirilecek.'
}

function showMessage(message) {
  window.clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.add('toast--visible')
  toastTimer = window.setTimeout(() => toast.classList.remove('toast--visible'), 3600)
}

function showView(target) {
  closeContentHud()
  document.querySelector('.view--active')?.classList.remove('view--active')
  document.querySelector('.nav-item--active')?.classList.remove('nav-item--active')
  $(`#${target}-view`)?.classList.add('view--active')
  document.querySelector(`[data-view="${target}"]`)?.classList.add('nav-item--active')
}

function contentTypeLabel() {
  return hudType === 'mod' ? 'Modlar' : 'Kaynak Paketleri'
}

function closeContentHud() {
  contentHudPanel.classList.remove('content-hud-panel--visible')
  contentHudPanel.setAttribute('aria-hidden', 'true')
  document.querySelector('[data-content-hud].content-hud-button--active')?.classList.remove('content-hud-button--active')
}

function setHudMode(mode) {
  hudMode = mode
  for (const tab of document.querySelectorAll('[data-hud-mode]')) {
    tab.classList.toggle('content-hud-tab--active', tab.dataset.hudMode === mode)
  }
  $('#content-hud-discover').classList.toggle('content-hud-pane--active', mode === 'discover')
  $('#content-hud-installed').classList.toggle('content-hud-pane--active', mode === 'installed')
  if (mode === 'installed') void loadInstalledContent()
}

function openContentHud(type) {
  const button = document.querySelector(`[data-content-hud="${type}"]`)
  if (hudType === type && contentHudPanel.classList.contains('content-hud-panel--visible')) {
    closeContentHud()
    return
  }
  hudType = type
  contentHudTitle.textContent = contentTypeLabel()
  contentSearch.placeholder = hudType === 'mod' ? 'Mod ara…' : 'Kaynak paketi ara…'
  document.querySelector('[data-content-hud].content-hud-button--active')?.classList.remove('content-hud-button--active')
  button?.classList.add('content-hud-button--active')
  contentHudPanel.classList.add('content-hud-panel--visible')
  contentHudPanel.setAttribute('aria-hidden', 'false')
  if (hudMode === 'installed') void loadInstalledContent()
  else setEmpty(marketResults, `${contentTypeLabel()} için bir ad ara.`)
}

function hideError() {
  errorPanel.classList.remove('error-panel--visible')
  errorPanel.setAttribute('aria-hidden', 'true')
}

function showError(message) {
  errorMessage.textContent = message
  errorPanel.classList.add('error-panel--visible')
  errorPanel.setAttribute('aria-hidden', 'false')
}

function updateMemoryUi(gigabytes) {
  const label = `${gigabytes} GB`
  memoryValue.textContent = label
  settingsMemoryValue.textContent = label
}

function setLaunchBusy(busy) {
  playButton.disabled = busy
  playLabel.textContent = busy ? 'HAZIRLANIYOR' : 'OYNA'
  launchProgress.classList.toggle('launch-progress--visible', busy)
  launchProgress.setAttribute('aria-hidden', String(!busy))
}

async function persistSettings() {
  settings = await window.kirazium.saveSettings({
    ...settings,
    nickname: nicknameInput.value.trim(),
    maxMemoryMb: Number(memoryRange.value) * 1024,
    closeOnLaunch: closeOnLaunch.checked,
  })
  refreshProfileLabels()
}

function setEmpty(container, message) {
  container.replaceChildren()
  const empty = document.createElement('div')
  empty.className = 'empty-state'
  empty.textContent = message
  container.append(empty)
}

function formatDownloads(value) {
  return new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function renderMarketResults(projects) {
  marketResults.replaceChildren()
  if (!projects.length) {
    setEmpty(marketResults, 'Bu sürüm için uyumlu içerik bulunamadı.')
    return
  }
  for (const project of projects) {
    const card = document.createElement('article')
    card.className = 'content-card'
    const copy = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = project.title
    const description = document.createElement('p')
    description.textContent = project.description
    const meta = document.createElement('span')
    meta.textContent = `${project.author} • ${formatDownloads(project.downloads)} indirme`
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'İNDİR'
    button.addEventListener('click', async () => {
      button.disabled = true
      button.textContent = 'İNDİRİLİYOR'
      try {
        await persistSettings()
        const result = await window.kirazium.installContent(hudType, project.projectId, settings)
        showMessage(result.message)
        button.textContent = result.ok ? 'İNDİRİLDİ' : 'TEKRAR DENE'
      } catch {
        showMessage('İçerik indirilemedi.')
        button.textContent = 'TEKRAR DENE'
      } finally {
        button.disabled = false
      }
    })
    copy.append(title, description, meta)
    card.append(copy, button)
    marketResults.append(card)
  }
}

async function searchMarket() {
  setEmpty(marketResults, 'İçerikler aranıyor…')
  try {
    await persistSettings()
    const projects = await window.kirazium.searchContent(hudType, contentSearch.value, settings)
    renderMarketResults(projects)
  } catch {
    setEmpty(marketResults, 'Modrinth servisine ulaşılamadı. Daha sonra tekrar dene.')
  }
}

function renderInstalled(items) {
  installedContent.replaceChildren()
  if (!items.length) {
    setEmpty(installedContent, hudType === 'mod' ? 'Bu profile kurulmuş mod yok.' : 'Bu profile kurulmuş kaynak paketi yok.')
    return
  }
  for (const item of items) {
    const card = document.createElement('article')
    card.className = 'content-card'
    const copy = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = item.displayName
    const meta = document.createElement('span')
    meta.textContent = item.enabled ? 'Etkin' : 'Devre dışı'
    const button = document.createElement('button')
    button.type = 'button'
    button.classList.toggle('disable', item.enabled)
    button.textContent = item.enabled ? 'KAPAT' : 'ETKİNLEŞTİR'
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        const next = await window.kirazium.setContentEnabled(hudType, item.fileName, !item.enabled, settings)
        renderInstalled(next)
      } catch {
        showMessage('İçerik durumu değiştirilemedi.')
        button.disabled = false
      }
    })
    copy.append(title, meta)
    card.append(copy, button)
    installedContent.append(card)
  }
}

async function loadInstalledContent() {
  setEmpty(installedContent, 'İçerikler okunuyor…')
  try {
    await persistSettings()
    renderInstalled(await window.kirazium.getInstalledContent(hudType, settings))
  } catch {
    setEmpty(installedContent, 'İçerik klasörü okunamadı.')
  }
}

function renderVersions() {
  versionSelect.replaceChildren()
  for (const version of versions) {
    const option = document.createElement('option')
    option.value = version.id
    option.textContent = `${version.id}${version.installed ? ' • indirildi' : ''}`
    versionSelect.append(option)
  }
  if (!versions.some((version) => version.id === settings.gameVersion)) {
    const option = document.createElement('option')
    option.value = settings.gameVersion
    option.textContent = settings.gameVersion
    versionSelect.prepend(option)
  }
  versionSelect.value = settings.gameVersion
  fabricEnabled.checked = settings.useFabric
  refreshProfileLabels()
}

for (const item of document.querySelectorAll('[data-view]')) {
  item.addEventListener('click', () => showView(item.dataset.view))
}

for (const button of document.querySelectorAll('[data-content-hud]')) {
  button.addEventListener('click', () => openContentHud(button.dataset.contentHud))
}

for (const tab of document.querySelectorAll('[data-hud-mode]')) {
  tab.addEventListener('click', () => setHudMode(tab.dataset.hudMode))
}

$('#minimize-button').addEventListener('click', () => void window.kirazium.minimizeWindow())
$('#maximize-button').addEventListener('click', () => void window.kirazium.toggleMaximizeWindow())
$('#close-button').addEventListener('click', () => void window.kirazium.closeWindow())
$('#logout-button').addEventListener('click', () => void window.kirazium.closeWindow())
$('#version-chip').addEventListener('click', () => showView('versions'))
$('#open-log-button').addEventListener('click', () => void window.kirazium.openLauncherLog().catch(() => showMessage('Hata kaydı açılamadı.')))
$('#content-search-button').addEventListener('click', () => void searchMarket())
contentSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter') void searchMarket() })
$('#open-content-folder').addEventListener('click', () => void window.kirazium.openContentFolder(hudType, settings))
$('#close-content-hud').addEventListener('click', closeContentHud)

versionSelect.addEventListener('change', () => {
  settings.gameVersion = versionSelect.value
  refreshProfileLabels()
})
fabricEnabled.addEventListener('change', () => {
  settings.useFabric = fabricEnabled.checked
  refreshProfileLabels()
})
$('#save-version-button').addEventListener('click', async () => {
  settings.gameVersion = versionSelect.value
  settings.useFabric = fabricEnabled.checked
  await persistSettings()
  showMessage(`${profileLabel()} seçildi.`)
  showView('game')
})

memoryRange.addEventListener('input', () => updateMemoryUi(Number(memoryRange.value)))
memoryRange.addEventListener('change', () => void persistSettings())
closeOnLaunch.addEventListener('change', () => void persistSettings())
nicknameInput.addEventListener('change', () => void persistSettings())

playButton.addEventListener('click', async () => {
  const nickname = nicknameInput.value.trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) {
    showMessage('Oyuncu adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanılabilir.')
    nicknameInput.focus()
    return
  }
  setLaunchBusy(true)
  hideError()
  try {
    await persistSettings()
    const result = await window.kirazium.launchGame(settings)
    if (!result.ok) showError(result.message || 'Minecraft başlatılamadı.')
    else showMessage('Minecraft açıldı.')
  } catch {
    showError('Başlatma isteği tamamlanamadı. Launcher’ı yeniden açıp dene.')
  } finally {
    const state = await window.kirazium.getLauncherState().catch(() => ({ busy: false }))
    setLaunchBusy(Boolean(state.busy))
  }
})

window.kirazium.onLauncherProgress((progress) => {
  progressMessage.textContent = progress.message
  progressValue.textContent = `${progress.progress}%`
  progressBar.style.width = `${progress.progress}%`
  const active = progress.stage !== 'idle' && progress.stage !== 'error'
  setLaunchBusy(active)
  if (progress.stage === 'error') showError(progress.message)
})

async function initialize() {
  try {
    const [savedSettings, launcherInfo, launcherState] = await Promise.all([
      window.kirazium.getSettings(),
      window.kirazium.getLauncherInfo(),
      window.kirazium.getLauncherState(),
    ])
    settings = savedSettings
    nicknameInput.value = settings.nickname
    const memoryGb = Math.max(2, Math.min(16, Math.round(settings.maxMemoryMb / 1024)))
    memoryRange.value = String(memoryGb)
    closeOnLaunch.checked = settings.closeOnLaunch
    updateMemoryUi(memoryGb)
    $('#app-version').textContent = `v${launcherInfo.version}`
    setLaunchBusy(launcherState.busy)
    renderVersions()
    try {
      versions = await window.kirazium.getMinecraftVersions()
      renderVersions()
    } catch {
      versionState.textContent = 'Sürüm listesi alınamadı; varsayılan profil kullanılabilir.'
    }
  } catch {
    showMessage('Başlatıcı ayarları okunamadı. Uygulamayı yeniden açmayı dene.')
  }
}

void initialize()

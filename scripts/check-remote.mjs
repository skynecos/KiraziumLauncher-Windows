const gameVersion = '26.1.2'
const fabricLoader = '0.19.3'

async function readJson(url, label) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'KiraziumLauncher/0.4.0' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`)
  return response.json()
}

const versionManifest = await readJson(
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  'Mojang sürüm listesi',
)
const versionMetadata = versionManifest.versions.find(
  (version) => version.id === gameVersion && version.type === 'release',
)
if (!versionMetadata) throw new Error(`Minecraft ${gameVersion} resmi sürüm listesinde yok.`)

const versionJson = await readJson(versionMetadata.url, 'Minecraft sürüm metadata’sı')
if (!versionJson.javaVersion?.component || !versionJson.javaVersion?.majorVersion) {
  throw new Error('Minecraft sürümü gerekli Java bilgisini içermiyor.')
}

const fabricProfile = await readJson(
  `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${fabricLoader}/profile/json`,
  'Fabric Loader profili',
)
if (fabricProfile.inheritsFrom !== gameVersion || !fabricProfile.mainClass) {
  throw new Error('Fabric Loader profili seçilen Minecraft sürümüyle uyumlu değil.')
}

const javaRuntimes = await readJson(
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
  'Mojang Java çalışma zamanları',
)
const windowsRuntime = javaRuntimes['windows-x64']?.[versionJson.javaVersion.component]
if (!Array.isArray(windowsRuntime) || windowsRuntime.length === 0) {
  throw new Error(`Windows için ${versionJson.javaVersion.component} Java bileşeni bulunamadı.`)
}

console.log(
  `Doğrulandı: Minecraft ${gameVersion}, Fabric ${fabricLoader}, Java ${versionJson.javaVersion.majorVersion}`,
)

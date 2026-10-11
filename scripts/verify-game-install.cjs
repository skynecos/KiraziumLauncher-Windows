const { join } = require('node:path')
const { LauncherService } = require('../dist/main/launcher.js')

const runnerTemp = process.env.RUNNER_TEMP || process.env.TEMP
if (!runnerTemp) throw new Error('Geçici çalışma dizini bulunamadı.')

const verificationRoot = join(runnerTemp, 'kirazium-launcher-game-verification')
let lastMessage = ''
const service = new LauncherService(verificationRoot, (progress) => {
  if (progress.message === lastMessage) return
  lastMessage = progress.message
  console.log(`[${progress.progress}%] ${progress.message}`)
})

async function verify() {
  for (const version of ['26.1.2', '26.2', '1.21.11']) {
    for (const fabric of [false, true]) {
      const result = await service.verifyInstallation(version, fabric)
      console.log(`Gerçek kurulum doğrulandı: ${result.version}`)
      console.log(`Java doğrulandı: ${result.javaPath}`)
    }
  }
}

verify().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

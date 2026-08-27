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

service.verifyInstallation().then((result) => {
  console.log(`Gerçek kurulum doğrulandı: ${result.version}`)
  console.log(`Java doğrulandı: ${result.javaPath}`)
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})

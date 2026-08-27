$ErrorActionPreference = 'Stop'

$launcherPath = Resolve-Path 'release\win-unpacked\Kirazium Launcher.exe'
$testDataPath = Join-Path $env:RUNNER_TEMP 'kirazium-launcher-smoke'
$launcher = $null

try {
  $launcher = Start-Process `
    -FilePath $launcherPath `
    -ArgumentList @('--disable-gpu', "--user-data-dir=$testDataPath") `
    -PassThru

  Start-Sleep -Seconds 8
  $launcher.Refresh()

  if ($launcher.HasExited) {
    throw "Kirazium Launcher erken kapandı. Çıkış kodu: $($launcher.ExitCode)"
  }

  Write-Host 'Kirazium Launcher Windows açılış testi başarılı.'
}
finally {
  if ($null -ne $launcher -and -not $launcher.HasExited) {
    Stop-Process -Id $launcher.Id -Force
  }
}

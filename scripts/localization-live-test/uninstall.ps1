# Localization live test — undoes install.ps1 (global.ini and user.cfg back to before).
param([string] $GameDir = 'C:\Program Files\Roberts Space Industries\StarCitizen\LIVE')
$ErrorActionPreference = 'Stop'
$ini = Join-Path $GameDir 'data\Localization\german_(germany)\global.ini'
$cfg = Join-Path $GameDir 'user.cfg'

if (Test-Path "$ini.sc-loc-test.bak") { Move-Item "$ini.sc-loc-test.bak" $ini -Force; Write-Host 'OK  global.ini restored' }
elseif (Test-Path $ini) { Remove-Item $ini; Write-Host 'OK  test global.ini removed' }

if (Test-Path "$cfg.sc-loc-test.created") { Remove-Item $cfg, "$cfg.sc-loc-test.created"; Write-Host 'OK  user.cfg removed (did not exist before)' }
elseif (Test-Path "$cfg.sc-loc-test.bak") { Move-Item "$cfg.sc-loc-test.bak" $cfg -Force; Write-Host 'OK  user.cfg restored' }

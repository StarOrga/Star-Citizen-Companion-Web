# Localization live test — installs a marker global.ini into the game folder.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1              # variant A + user.cfg
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Variant B   # swap to B while the game runs
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1            # restore everything
#
# Writes LIVE\data\Localization\german_(germany)\global.ini (the folder CIG
# uses for German; a CIG copy there is backed up first) and adds
# g_language / g_languageAudio to LIVE\user.cfg (backed up first).
param(
  [ValidateSet('A', 'B')] [string] $Variant = 'A',
  [string] $GameDir = 'C:\Program Files\Roberts Space Industries\StarCitizen\LIVE',
  [string] $Build = ''
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$locDir = Join-Path $GameDir 'data\Localization\german_(germany)'
$ini = Join-Path $locDir 'global.ini'
$cfg = Join-Path $GameDir 'user.cfg'
$tmp = Join-Path $env:TEMP "sc-loc-test-global.$Variant.ini"

if (-not (Test-Path (Join-Path $GameDir 'Data.p4k'))) { throw "No Data.p4k in $GameDir - pass -GameDir" }

$nodeArgs = @("$here\build-test-ini.mjs", '--marker', $Variant, '--out', $tmp)
if ($Build) { $nodeArgs += @('--build', $Build) }
node @nodeArgs
if ($LASTEXITCODE -ne 0) { throw 'building the test file failed' }

New-Item -ItemType Directory -Force $locDir | Out-Null
if ((Test-Path $ini) -and -not (Test-Path "$ini.sc-loc-test.bak")) { Copy-Item $ini "$ini.sc-loc-test.bak" }

# Write next to the target, then swap: a sharing violation here means the game
# holds the file open, which is itself a test result.
try {
  Copy-Item $tmp "$ini.new" -Force
  Move-Item "$ini.new" $ini -Force
  Write-Host "OK  global.ini = variant [$Variant]"
} catch {
  Write-Host "LOCKED  could not replace global.ini while the game runs: $($_.Exception.Message)"
  exit 2
}

if ($Variant -eq 'A') {
  if ((Test-Path $cfg) -and -not (Test-Path "$cfg.sc-loc-test.bak")) { Copy-Item $cfg "$cfg.sc-loc-test.bak" }
  if (-not (Test-Path $cfg)) { New-Item -ItemType File $cfg | Out-Null; New-Item -ItemType File "$cfg.sc-loc-test.created" | Out-Null }
  $lines = @(Get-Content $cfg -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^\s*g_language(Audio)?\s*=' })
  $lines += 'g_language = german_(germany)'
  $lines += 'g_languageAudio = english'
  # user.cfg: UTF-8 without BOM.
  [System.IO.File]::WriteAllLines($cfg, $lines, (New-Object System.Text.UTF8Encoding $false))
  Write-Host 'OK  user.cfg: g_language = german_(germany), g_languageAudio = english'
}

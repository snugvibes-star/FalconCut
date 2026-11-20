# Install CutFlow as a normal Windows app: Desktop + Start Menu shortcuts with
# the real brand icon, launching the local server and an app window (no address
# bar). Run it by right-clicking -> "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File ".\Install CutFlow.ps1"
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat  = Join-Path $root 'Start CutFlow.bat'
$vbs  = Join-Path $root 'Start CutFlow.vbs'
$ico  = Join-Path $root 'public\cutflow.ico'

if (-not (Test-Path $bat)) { throw "Start CutFlow.bat is missing next to this script." }
if (-not (Test-Path $vbs)) { throw "Start CutFlow.vbs is missing next to this script." }
if (-not (Test-Path $ico)) {
  Write-Host 'Building the app icon...'
  Push-Location $root
  node scripts/make-ico.mjs
  Pop-Location
}
if (-not (Test-Path $ico)) { throw 'public\cutflow.ico could not be created.' }

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Write-Host 'First install: building the app (this takes about a minute)...'
  Push-Location $root
  npm install
  npm run build
  Pop-Location
}

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)

foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { continue }
  $lnkPath = Join-Path $dir 'CutFlow.lnk'
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath       = Join-Path $env:WINDIR 'System32\wscript.exe'
  $lnk.Arguments        = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation     = $ico
  $lnk.Description      = 'CutFlow — AI-native video editor'
  $lnk.Save()
  Write-Host "Shortcut created: $lnkPath"
}

Write-Host ''
Write-Host 'CutFlow is installed.' -ForegroundColor Green
Write-Host 'Double-click the CutFlow icon on your desktop. The first launch starts the local server and opens the editor in its own window.'
Write-Host 'To remove it: delete the two CutFlow shortcuts.'

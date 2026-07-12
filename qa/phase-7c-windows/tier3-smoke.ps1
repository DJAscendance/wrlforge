# Phase 7C4 Tier 3 -- Windows shell/integration smoke (PowerShell only).
#
# Covers what Tier 1 (packed self-test) and Tier 2 (capture-server visual QA)
# cannot reach: the NSIS installer/uninstaller, the Start-Menu shortcut it
# creates, and a capture-server smoke run against the INSTALLED exe.
#
# Deliberately NOT automated here (per docs/WINDOWS_NATIVE_QA_PLAN.md Sec.4/Sec.13,
# proposed: maintainer-manual, documented):
#   - the SmartScreen "unknown publisher" prompt (unsigned beta -- expected)
#   - native Open/Save file dialogs
#   - visually confirming the Start-Menu tile/icon
# These need a human (or the noVNC fallback) at the keyboard, not a UI-automation
# stack (Playwright-Electron/WinAppDriver/Appium are explicitly rejected as
# unjustified for a private unsigned beta).
#
# THIS SCRIPT INSTALLS AND UNINSTALLS THE APP. Run it deliberately, not as part
# of an unattended pipeline, and only against a beta build you intend to test.
#
# Usage:
#   powershell -File qa\phase-7c-windows\tier3-smoke.ps1 `
#     -InstallerPath "release\WRL Forge-1.2.0-beta.2-x64-PrivateBeta-Unsigned-setup.exe" `
#     -OutDir "C:\wrlforge-qa\tier3"

param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (-not (Test-Path $InstallerPath)) {
  throw "Installer not found at $InstallerPath -- build it first (npm run build:win)."
}

function Write-Step($msg) {
  $line = "[tier3] $msg"
  Write-Output $line
  Add-Content -Path (Join-Path $OutDir 'tier3-console.txt') -Value $line
}

Write-Step "tasklist snapshot (before)"
tasklist | Out-File (Join-Path $OutDir 'tasklist-before.txt') -Encoding utf8

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\wrl-forge-qa-tier3'
Write-Step "silent per-user install into $installDir"
& $InstallerPath /S "/D=$installDir" | Out-Null
Start-Sleep -Seconds 3

$exePath = Join-Path $installDir 'WRL Forge.exe'
$installOk = Test-Path $exePath
Write-Step "installed exe present: $installOk ($exePath)"

$startMenuGlob = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\WRL Forge*.lnk'
$shortcut = Get-ChildItem -Path $startMenuGlob -ErrorAction SilentlyContinue
Write-Step "Start-Menu shortcut present: $([bool]$shortcut) ($($shortcut.FullName -join ', '))"

Write-Step "capture-server smoke against the installed exe (Tier 2 reused, --target=installed)"
$smokeJobs = Join-Path $OutDir 'tier3-smoke-jobs.json'
'[{"id":"tier3-smoke","json":true}]' | Out-File $smokeJobs -Encoding utf8
node "$(Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'qa\visual-qa\cli.js')" `
  $smokeJobs --target=installed --exe="$exePath" --allow-headed --max=1 --retries=0 `
  *> (Join-Path $OutDir 'tier3-capture-smoke.log')
$smokeOk = $LASTEXITCODE -eq 0
Write-Step "capture-server smoke exit ok: $smokeOk"

Write-Step "tasklist snapshot (after launch/smoke, before uninstall)"
tasklist | Out-File (Join-Path $OutDir 'tasklist-mid.txt') -Encoding utf8

$uninstaller = Join-Path $installDir 'Uninstall WRL Forge.exe'
if (Test-Path $uninstaller) {
  Write-Step "silent uninstall via $uninstaller"
  & $uninstaller /S | Out-Null
  Start-Sleep -Seconds 3
} else {
  Write-Step "WARNING: no uninstaller found at $uninstaller -- install dir may need manual cleanup"
}

$stillInstalled = Test-Path $exePath
$shortcutAfter = Get-ChildItem -Path $startMenuGlob -ErrorAction SilentlyContinue
Write-Step "post-uninstall: exe still present=$stillInstalled shortcut still present=$([bool]$shortcutAfter)"

Write-Step "tasklist snapshot (after)"
tasklist | Out-File (Join-Path $OutDir 'tasklist-after.txt') -Encoding utf8

$summary = [ordered]@{
  installerPath      = (Resolve-Path $InstallerPath).Path
  installOk           = $installOk
  shortcutPresent     = [bool]$shortcut
  captureSmokeOk      = $smokeOk
  uninstallerFound    = (Test-Path $uninstaller)
  exeRemovedAfterUninstall  = -not $stillInstalled
  shortcutRemovedAfterUninstall = -not [bool]$shortcutAfter
}
$summary | ConvertTo-Json | Out-File (Join-Path $OutDir 'tier3-summary.json') -Encoding utf8
Write-Step "done -- summary written to tier3-summary.json"

if (-not $installOk -or -not $smokeOk -or $stillInstalled) {
  Write-Step "one or more checks failed -- treat this Tier 3 run as NO-GO"
  exit 1
}
exit 0

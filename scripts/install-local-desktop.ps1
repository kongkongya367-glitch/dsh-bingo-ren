<#
.SYNOPSIS
  Install this checkout into a real DSH profile without npm (advanced local path).

.DESCRIPTION
  For evaluating Bingo before it is published. It copies this checkout into
  <DSH_HOME>/profiles/<ProfileName>/node_modules/dsh-bingo-ren, backs up the
  profile's package.json, then adds the dependency and the dsh.profile.bundles entry.

  This edits the real profile, so quit DeepSeek Harness first. The script does not
  install dependencies, run npm publish, kill processes or restart the app.

  Use -Uninstall to remove only Bingo's entries and the installed package.
  Use -WhatIf to preview every change. The default profile is "desktop"; prefer a
  disposable self-test profile unless you really mean the desktop app.

  Once the package is published, the supported path is Settings -> Plugins -> Add plugin.

.PARAMETER DshHome
  DSH home directory. Defaults to $env:DSH_HOME, then ~/.dsh.

.PARAMETER ProfileName
  Profile to modify. Defaults to desktop. Only [A-Za-z0-9._-] is accepted.

.PARAMETER Uninstall
  Remove Bingo's dependency and bundle entry, preserving other profile changes.

.PARAMETER Force
  Skip the running-DeepSeek-Harness check. The script still never kills or restarts it.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -WhatIf

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -Uninstall
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [string]$DshHome,
  [string]$ProfileName = 'desktop',
  [switch]$Uninstall,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoDir = Split-Path -Parent $PSScriptRoot
$repoManifest = Join-Path $repoDir 'package.json'
if (-not (Test-Path -LiteralPath $repoManifest)) {
  throw "Cannot find package.json in '$repoDir'. Run this script from a checkout of dsh-bingo-ren."
}

if ($ProfileName -notmatch '^[A-Za-z0-9._-]+$' -or $ProfileName -in @('.', '..')) {
  throw "Invalid -ProfileName '$ProfileName'. Use letters, digits, dot, underscore or dash."
}

if (-not $DshHome -or $DshHome.Trim() -eq '') {
  if ($env:DSH_HOME) {
    $DshHome = $env:DSH_HOME
  }
  else {
    $DshHome = Join-Path $HOME '.dsh'
  }
}
if ($DshHome.StartsWith('~')) {
  $rest = $DshHome.Substring(1).TrimStart([char[]]@('\', '/'))
  $DshHome = if ($rest) { Join-Path $HOME $rest } else { $HOME }
}
$DshHome = [System.IO.Path]::GetFullPath($DshHome)
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $ProfileName
$manifestPath = Join-Path $profileDir 'package.json'
$backupPath = Join-Path $profileDir 'package.json.bingo-backup'
$nodeModulesDir = Join-Path $profileDir 'node_modules'
$targetDir = Join-Path $nodeModulesDir 'dsh-bingo-ren'

function Remove-BingoPackage {
  # Validate the absolute destination before any recursive deletion. A local
  # development install may be a junction to the checkout: unlink it only.
  $resolvedTarget = [System.IO.Path]::GetFullPath($targetDir)
  $resolvedModules = [System.IO.Path]::GetFullPath($nodeModulesDir).TrimEnd([char[]]@('\', '/'))
  if (-not $resolvedTarget.StartsWith($resolvedModules + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or
      [System.IO.Path]::GetFileName($resolvedTarget) -ne 'dsh-bingo-ren') {
    throw 'Refusing to remove a package outside the selected profile node_modules.'
  }
  $installed = Get-Item -LiteralPath $resolvedTarget -Force -ErrorAction SilentlyContinue
  if ($null -eq $installed) { return }
  if (($installed.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    [System.IO.Directory]::Delete($resolvedTarget)
  }
  else {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

function Assert-HarnessClosed {
  param([switch]$SkipCheck)
  if ($SkipCheck) {
    Write-Warning 'Running-process check skipped with -Force. Quit DeepSeek Harness before starting it again.'
    return
  }
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match 'DeepSeek' -or $_.ProcessName -match 'Harness' -or $_.ProcessName -match '^dsh-desktop'
  })
  if ($running.Count -eq 0) { return }
  $pids = ($running | ForEach-Object { "$($_.ProcessName) ($($_.Id))" }) -join ', '
  if ($WhatIfPreference) {
    Write-Warning "DeepSeek Harness looks running: $pids. -WhatIf writes nothing, but quit the app before a real run."
    return
  }
  throw "DeepSeek Harness looks running: $pids. Quit the app before changing its profile, or pass -Force. This script never kills or restarts it."
}

function Read-ProfileManifest {
  try {
    return Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  catch {
    throw "Cannot parse '$manifestPath' as JSON: $($_.Exception.Message)"
  }
}

function Ensure-ObjectProperty {
  param($Object, [string]$Name)
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value ([pscustomobject]@{}) -Force
  }
}

function Ensure-ArrayProperty {
  param($Object, [string]$Name)
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value @() -Force
  }
}

function Write-ProfileManifest {
  param($Manifest)
  $json = ($Manifest | ConvertTo-Json -Depth 100) + [Environment]::NewLine
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($manifestPath, $json, $utf8NoBom)
}

Write-Host "Bingo local profile install (advanced)"
Write-Host "  DSH home : $DshHome"
Write-Host "  profile  : $ProfileName"
Write-Host "  repo     : $repoDir"

Assert-HarnessClosed -SkipCheck:$Force

if ($Uninstall) {
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "No profile manifest at '$manifestPath'. Refusing to modify an unknown profile."
  }
  $manifest = Read-ProfileManifest
  if ($null -ne $manifest.dependencies) {
    $manifest.dependencies.PSObject.Properties.Remove('dsh-bingo-ren')
  }
  if ($null -ne $manifest.dsh -and $null -ne $manifest.dsh.profile -and
      $null -ne $manifest.dsh.profile.bundles) {
    $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-bingo-ren' })
  }
  if ($PSCmdlet.ShouldProcess($manifestPath, 'Remove only the Bingo dependency and bundle entry')) {
    Write-ProfileManifest -Manifest $manifest
  }
  if (Test-Path -LiteralPath $targetDir) {
    if ($PSCmdlet.ShouldProcess($targetDir, 'Remove copied dsh-bingo-ren package')) {
      Remove-BingoPackage
    }
  }
  if ($WhatIfPreference) {
    Write-Host ""
    Write-Host "WhatIf: no files were changed."
    return
  }
  Write-Host ""
  Write-Host "Removed Bingo from '$manifestPath'; other plugin entries are preserved."
  Write-Host 'Any existing backup is retained for manual recovery.'
  return
}

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "No profile manifest at '$manifestPath'. Start the app once with this profile, or check -DshHome/-ProfileName."
}

$manifest = Read-ProfileManifest

# Validate the copy source before touching the profile.
$copyItems = @('package.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'README.zh.md', 'LICENSE', 'lib', 'client', 'assets', 'screenshots.json')
$presentItems = @()
foreach ($item in $copyItems) {
  if (Test-Path -LiteralPath (Join-Path $repoDir $item)) { $presentItems += $item }
}
foreach ($requiredItem in @('package.json', 'cordis.patch.yml', 'lib', 'client')) {
  if ($presentItems -notcontains $requiredItem) {
    throw "The checkout is incomplete: missing '$requiredItem'. Build/copy lib and client before installing locally."
  }
}

# Back up the pristine manifest once; later reinstalls keep the original backup.
if (Test-Path -LiteralPath $backupPath) {
  Write-Host "Backup   : existing '$backupPath' kept"
}
else {
  if ($PSCmdlet.ShouldProcess($backupPath, 'Back up profile package.json')) {
    Copy-Item -LiteralPath $manifestPath -Destination $backupPath -Force
    Write-Host "Backup   : '$backupPath'"
  }
}

# Copy the package into node_modules, replacing a previous local copy.
if ($PSCmdlet.ShouldProcess($targetDir, 'Copy dsh-bingo-ren into profile node_modules')) {
  if (Test-Path -LiteralPath $targetDir) {
    Remove-BingoPackage
  }
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  foreach ($item in $presentItems) {
    Copy-Item -LiteralPath (Join-Path $repoDir $item) -Destination $targetDir -Recurse -Force
  }
  Write-Host "Copied   : '$targetDir'"
}

# Add the dependency and bundle selection to the profile manifest.
Ensure-ObjectProperty -Object $manifest -Name 'dependencies'
Ensure-ObjectProperty -Object $manifest -Name 'dsh'
Ensure-ObjectProperty -Object $manifest.dsh -Name 'profile'
Ensure-ArrayProperty -Object $manifest.dsh.profile -Name 'bundles'

$dependencyValue = "link:$repoDir"
$existingDependency = $manifest.dependencies.PSObject.Properties['dsh-bingo-ren']
if ($null -eq $existingDependency) {
  $manifest.dependencies | Add-Member -MemberType NoteProperty -Name 'dsh-bingo-ren' -Value $dependencyValue
}
else {
  $manifest.dependencies.'dsh-bingo-ren' = $dependencyValue
}

$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-bingo-ren') {
  $manifest.dsh.profile.bundles = @($bundles + 'dsh-bingo-ren')
  Write-Host "Bundles  : added 'dsh-bingo-ren'"
}
else {
  Write-Host "Bundles  : 'dsh-bingo-ren' already selected"
}

if ($PSCmdlet.ShouldProcess($manifestPath, "Add dsh-bingo-ren dependency ($dependencyValue) and bundle entry")) {
  Write-ProfileManifest -Manifest $manifest
  Write-Host "Updated  : '$manifestPath'"
}

if ($WhatIfPreference) {
  Write-Host ""
  Write-Host "WhatIf: no files were changed."
  return
}

Write-Host ""
Write-Host "Local install prepared. Start DeepSeek Harness, open Settings -> Plugins, and confirm Bingo is listed and enabled."
Write-Host "The button appears after the app loads the plugin; this script never starts or restarts the app."
Write-Host "Remove it later with:"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -Uninstall"

<#
.SYNOPSIS
  Install this checkout into a disposable, non-desktop DSH profile for testing.

.DESCRIPTION
  Local development helper. It runs the equivalent of:

      dsh plugin --profile bingo-selftest add link:<this checkout>

  The profile defaults to "bingo-selftest". The script refuses to use "desktop"
  or "default" so it can never touch the profile of the running DeepSeek Harness
  desktop app. Official installs belong in the app: Settings -> Plugins -> Add plugin.

.PARAMETER ProfileName
  Self-test profile name. Defaults to bingo-selftest. "desktop" and "default" are rejected.

.PARAMETER DshHome
  Optional DSH_HOME for the install. Use a workspace-local directory (for example
  .testhome) when the default home is not writable. Defaults to the user's ~/.dsh.

.PARAMETER DshCli
  Optional path/name of the dsh CLI. Defaults to "dsh" on PATH, then "dsh-plugin".

.EXAMPLE
  powershell -NoProfile -File scripts/install.ps1

.EXAMPLE
  powershell -NoProfile -File scripts/install.ps1 -ProfileName bingo-selftest -DshHome ./.testhome
#>
[CmdletBinding()]
param(
  [string]$ProfileName = 'bingo-selftest',
  [string]$DshHome,
  [string]$DshCli
)

$ErrorActionPreference = 'Stop'

$forbidden = @('desktop', 'default')
if ($forbidden -contains $ProfileName.Trim().ToLowerInvariant()) {
  throw "Refusing to use profile '$ProfileName': this script only installs into a disposable self-test profile. Official installs go through Settings -> Plugins in the app."
}

$repoDir = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $repoDir 'package.json'
if (-not (Test-Path -LiteralPath $manifest)) {
  throw "Cannot find package.json in '$repoDir'. Run this script from a checkout of dsh-bingo-restart."
}

$cli = $DshCli
if (-not $cli) {
  foreach ($candidate in @('dsh', 'dsh-plugin')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) { $cli = $candidate; break }
  }
}
if (-not $cli) {
  throw "Cannot find the dsh CLI. Put 'dsh' on PATH or pass -DshCli <path>."
}

$linkSpec = "link:$repoDir"
$cliArgs = @('plugin', '--profile', $ProfileName, 'add', $linkSpec)

Write-Host "Bingo development install"
Write-Host "  CLI      : $cli"
Write-Host "  profile  : $ProfileName (not the desktop profile)"
Write-Host "  package  : $linkSpec"
if ($DshHome) { Write-Host "  DSH_HOME : $DshHome" }

$previousDshHome = $env:DSH_HOME
try {
  if ($DshHome) { $env:DSH_HOME = $DshHome }
  & $cli @cliArgs
  if ($LASTEXITCODE -ne 0) {
    throw "dsh exited with code $LASTEXITCODE. The self-test profile was not modified successfully."
  }
}
finally {
  $env:DSH_HOME = $previousDshHome
}

Write-Host ""
Write-Host "Installed into profile '$ProfileName'."
Write-Host "Start a session that uses that profile, then confirm the Bingo button appears bottom-left."
Write-Host "This profile is separate from the running desktop app; the desktop app is untouched."
Write-Host "Remove it later with: dsh plugin --profile $ProfileName remove dsh-bingo-restart"

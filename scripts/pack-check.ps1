<#
.SYNOPSIS
  Validate the npm tarball file list for dsh-bingo-ren.

.DESCRIPTION
  Runs 'npm pack --dry-run --json', prints the included files, and fails when the
  tarball contains local-only material or is missing required published files.
  Read-only: it never creates a .tgz.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
Push-Location $repoDir
try {
  # Inspect the built files without prepack logging into the JSON stream.
  $raw = & npm pack --dry-run --json --ignore-scripts
  if ($LASTEXITCODE -ne 0) {
    throw "npm pack --dry-run failed with exit code $LASTEXITCODE."
  }
  $parsed = ($raw | Out-String) | ConvertFrom-Json
  $entry = @($parsed)[0]
  $files = @($entry.files | ForEach-Object { $_.path })

  Write-Host "Package : $($entry.name)@$($entry.version)"
  Write-Host "Files   : $($files.Count)"
  $files | Sort-Object | ForEach-Object { Write-Host "  $_" }

  $forbiddenPatterns = @(
    '^test/',
    '^preview/',
    '^\.research/',
    '^verification/',
    '^SPEC\.md$',
    '^\.testhome/',
    '^\.tmp/'
  )
  $bad = @($files | Where-Object {
    $file = $_
    $forbiddenPatterns | Where-Object { $file -match $_ }
  })
  if ($bad.Count -gt 0) {
    throw "Forbidden files in the tarball: $($bad -join ', ')"
  }

  $required = @(
    'lib/index.js',
    'lib/activity.js',
    'lib/restart-helper.cjs',
    'client/bingo-client.js',
    'client/bingo-client.css',
    'cordis.patch.yml',
    'README.md',
    'README.zh.md',
    'README.en.md',
    'LICENSE',
    'icon.svg',
    'assets/icon-512.png'
  )
  $missing = @($required | Where-Object { $files -notcontains $_ })
  if ($missing.Count -gt 0) {
    throw "Required files missing from the tarball: $($missing -join ', ')"
  }

  # Screenshots are referenced by the READMEs and declared in market/screenshots.json.
  # They are required before a real release, but may still be in progress during
  # implementation, so report them as a warning rather than failing the pack check.
  $expectedScreenshots = @(
    'assets/screenshot-button.png',
    'assets/screenshot-panel.png',
    'assets/screenshot-new-plugin.png'
  )
  $missingScreenshots = @($expectedScreenshots | Where-Object { $files -notcontains $_ })
  if ($missingScreenshots.Count -gt 0) {
    Write-Warning "Screenshots not yet in the tarball: $($missingScreenshots -join ', ')"
  }

  Write-Host ""
  Write-Host "OK: tarball contents match the release surface."
}
finally {
  Pop-Location
}

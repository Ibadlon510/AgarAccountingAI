# Repair broken pnpm junctions on Windows/OneDrive.
#
# pnpm creates junctions with RELATIVE reparse targets which OneDrive sync can
# invalidate. This script:
#   1. Walks every .pnpm/<pkg>@<ver>/node_modules/[@scope/]<name> entry.
#   2. If a target's package.json is unreachable, reads the reparse data to
#      recover the intended pnpm store folder name (e.g. "@babel+code-frame@7.29.7"),
#      resolves it to an ABSOLUTE path, deletes the broken junction with rmdir
#      (the only reliable way on Windows) and recreates it with mklink /J.
#   3. Reports remaining unresolvable entries.

$ErrorActionPreference = 'Continue'
$root = "c:\Users\cliff\OneDrive - Freezoner\Documents\Claude\AgarAccountingAI"
$pnpmRoot = Join-Path $root "node_modules\.pnpm"

function Get-ReparseTarget([string]$path) {
  $q = & cmd /c "fsutil reparsepoint query `"$path`"" 2>$null
  if (-not $q) { return $null }
  $text = [string]::Join(' ', ($q | Where-Object { $_ -match '^\s*[0-9A-Fa-f]{4}:' } | ForEach-Object {
    ($_ -split '\s{2,}')[1]
  }))
  # Extract path chars from the mixed-view dump. Simpler: parse right column ASCII.
  $ascii = ($q | Where-Object { $_ -match '^\s*[0-9A-Fa-f]{4}:' } | ForEach-Object {
    if ($_ -match ':\s+[0-9A-Fa-f\s]+\s{2,}(.+)$') { $matches[1] }
  }) -join ''
  # Strip leading 4 metadata bytes (rendered as first 4 chars, typically ".").
  if ($ascii.Length -gt 4) { $ascii = $ascii.Substring(4) }
  return $ascii.Trim()
}

$fixed = 0
$stillBroken = @()
$scanned = 0

Get-ChildItem $pnpmRoot -Directory | ForEach-Object {
  $pnpmDir = $_.FullName
  $nm = Join-Path $pnpmDir "node_modules"
  if (-not (Test-Path $nm)) { return }
  Get-ChildItem $nm -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $entry = $_
    if ($entry.Name -like '.*') { return }
    $candidates = @()
    if ($entry.Name.StartsWith('@')) {
      Get-ChildItem $entry.FullName -Force -ErrorAction SilentlyContinue |
        Where-Object { -not $_.Name.StartsWith('.') } | ForEach-Object {
          $candidates += ,@{ Scope = $entry.Name; Name = $_.Name; Path = $_.FullName }
        }
    } else {
      $candidates += ,@{ Scope = $null; Name = $entry.Name; Path = $entry.FullName }
    }
    foreach ($c in $candidates) {
      $script:scanned++
      $pj = Join-Path $c.Path "package.json"
      if (Test-Path $pj) { continue }

      # Read the reparse relative target and derive the pnpm store folder name.
      $target = Get-ReparseTarget $c.Path
      $pnpmFolder = $null
      if ($target -match '\.pnpm[\\/]([^\\/]+)[\\/]node_modules') {
        $pnpmFolder = $matches[1]
      }
      $absTarget = $null
      if ($pnpmFolder) {
        $abs = Join-Path $pnpmRoot $pnpmFolder
        $suffix = if ($c.Scope) { "node_modules\$($c.Scope)\$($c.Name)" } else { "node_modules\$($c.Name)" }
        $abs = Join-Path $abs $suffix
        if (Test-Path (Join-Path $abs "package.json")) { $absTarget = $abs }
      }
      if (-not $absTarget) {
        $script:stillBroken += "$($c.Scope)/$($c.Name) in $($_.Parent.Parent.Name) (target=$target)"
        continue
      }

      & cmd /c "rmdir `"$($c.Path)`"" 2>$null | Out-Null
      Start-Sleep -Milliseconds 20
      if (Test-Path $c.Path) {
        & cmd /c "rmdir /S /Q `"$($c.Path)`"" 2>$null | Out-Null
      }
      if (Test-Path $c.Path) {
        $script:stillBroken += "$($c.Scope)/$($c.Name) [cannot remove]"
        continue
      }
      & cmd /c "mklink /J `"$($c.Path)`" `"$absTarget`"" | Out-Null
      if (Test-Path (Join-Path $c.Path "package.json")) { $script:fixed++ }
      else { $script:stillBroken += "$($c.Scope)/$($c.Name) [relink failed]" }
    }
  }
}

Write-Output "scanned=$scanned fixed=$fixed stillBroken=$($stillBroken.Count)"
$stillBroken | Select-Object -First 20

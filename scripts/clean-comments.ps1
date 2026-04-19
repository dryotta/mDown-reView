#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Clean up review comment sidecar files.
.PARAMETER Directory
    Root directory to scan (default: current directory)
.PARAMETER All
    Delete all sidecar files (not just resolved)
.PARAMETER DryRun
    Preview without making changes
#>
param(
    [string]$Directory = ".",
    [switch]$All,
    [switch]$DryRun
)

function Write-Atomic {
    param([string]$Path, [object]$Data)
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $Data | ConvertTo-Json -Depth 10 | Set-Content -Path $tmp -Encoding UTF8
        Move-Item -Path $tmp -Destination $Path -Force
    } catch {
        Remove-Item -Path $tmp -ErrorAction SilentlyContinue
        throw
    }
}

$modified = 0
$deleted = 0

Get-ChildItem -Path $Directory -Recurse -Filter "*.review.json" | ForEach-Object {
    $path = $_.FullName

    if ($All) {
        if ($DryRun) {
            Write-Output "[DRY RUN] Would delete $path"
        } else {
            Remove-Item -Path $path
        }
        $script:deleted++
        return
    }

    try {
        $data = Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warning "WARNING: ${path}: $_"
        return
    }

    $originalCount = $data.comments.Count
    $data.comments = @($data.comments | Where-Object { -not $_.resolved })

    if ($data.comments.Count -eq 0) {
        if ($DryRun) {
            Write-Output "[DRY RUN] Would delete $path (all $originalCount resolved)"
        } else {
            Remove-Item -Path $path
        }
        $script:deleted++
    } elseif ($data.comments.Count -lt $originalCount) {
        if ($DryRun) {
            Write-Output "[DRY RUN] Would remove $($originalCount - $data.comments.Count) resolved from $path"
        } else {
            Write-Atomic -Path $path -Data $data
        }
        $script:modified++
    }
}

$prefix = if ($DryRun) { "[DRY RUN] " } else { "" }
Write-Output "${prefix}Modified $modified file(s), deleted $deleted file(s)"

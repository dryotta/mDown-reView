#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Resolve review comments.
.PARAMETER Directory
    Root directory to scan
.PARAMETER File
    Specific file path
.PARAMETER Id
    Comment IDs to resolve (repeatable)
.PARAMETER RespondedBy
    Resolve comments responded to by this author
.PARAMETER All
    Resolve all comments
.PARAMETER DryRun
    Preview without making changes
#>
param(
    [string]$Directory,
    [string]$File,
    [string[]]$Id,
    [string]$RespondedBy,
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

function Resolve-InFile {
    param([string]$SidecarPath, [string[]]$Ids, [string]$RespondedByAuthor, [bool]$AllComments, [bool]$IsDryRun)
    try {
        $data = Get-Content -Path $SidecarPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warning "WARNING: ${SidecarPath}: $_"
        return 0
    }

    $count = 0
    foreach ($c in $data.comments) {
        if ($c.resolved) { continue }
        $shouldResolve = $false
        if ($AllComments) {
            $shouldResolve = $true
        } elseif ($Ids -and $Ids -contains $c.id) {
            $shouldResolve = $true
        } elseif ($RespondedByAuthor) {
            foreach ($r in $c.responses) {
                if ($r.author -eq $RespondedByAuthor) {
                    $shouldResolve = $true
                    break
                }
            }
        }
        if ($shouldResolve) {
            if (-not $IsDryRun) { $c.resolved = $true }
            $count++
        }
    }

    if ($count -gt 0 -and -not $IsDryRun) {
        Write-Atomic -Path $SidecarPath -Data $data
    }
    return $count
}

$total = 0
if ($File) {
    $sidecar = "$File.review.json"
    $total = Resolve-InFile -SidecarPath $sidecar -Ids $Id -RespondedByAuthor $RespondedBy -AllComments $All.IsPresent -IsDryRun $DryRun.IsPresent
} else {
    $dir = if ($Directory) { $Directory } else { "." }
    Get-ChildItem -Path $dir -Recurse -Filter "*.review.json" | ForEach-Object {
        $total += Resolve-InFile -SidecarPath $_.FullName -Ids $Id -RespondedByAuthor $RespondedBy -AllComments $All.IsPresent -IsDryRun $DryRun.IsPresent
    }
}

$prefix = if ($DryRun) { "[DRY RUN] " } else { "" }
Write-Output "${prefix}Resolved $total comment(s)"

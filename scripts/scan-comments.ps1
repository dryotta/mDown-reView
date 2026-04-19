#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Scan .review.json sidecar files and display comments.
.PARAMETER Directory
    Root directory to scan (default: current directory)
.PARAMETER Unresolved
    Show only unresolved comments
.PARAMETER Resolved
    Show only resolved comments
.PARAMETER AsJson
    Output as JSON
#>
param(
    [string]$Directory = ".",
    [switch]$Unresolved,
    [switch]$Resolved,
    [switch]$AsJson
)

$statusFilter = $null
if ($Unresolved) { $statusFilter = "unresolved" }
elseif ($Resolved) { $statusFilter = "resolved" }

$results = @()

Get-ChildItem -Path $Directory -Recurse -Filter "*.review.json" | Sort-Object FullName | ForEach-Object {
    $sidecarPath = $_.FullName
    $reviewedFile = $sidecarPath -replace '\.review\.json$', ''
    $relPath = [System.IO.Path]::GetRelativePath($Directory, $reviewedFile)

    try {
        $data = Get-Content -Path $sidecarPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warning "WARNING: ${sidecarPath}: $_"
        return
    }

    $sourceLines = @()
    if (Test-Path $reviewedFile) {
        try {
            $sourceLines = (Get-Content -Path $reviewedFile -Encoding UTF8)
        } catch { }
    }

    foreach ($c in $data.comments) {
        $anchor = if ($c.anchorType) { $c.anchorType } else { "block" }
        $lineNum = if ($c.lineNumber) { $c.lineNumber } elseif ($c.fallbackLine) { $c.fallbackLine } else { 1 }
        $status = if ($c.resolved) { "resolved" } else { "unresolved" }
        if ($anchor -eq "block") { $status = "orphaned" }

        if ($statusFilter -and $status -ne $statusFilter) { continue }

        $ref = "<n/a>"
        if ($anchor -eq "selection" -and $c.selectedText) {
            $ref = $c.selectedText.Substring(0, [Math]::Min(60, $c.selectedText.Length))
        } elseif ($anchor -eq "line" -and $lineNum -ge 1 -and $lineNum -le $sourceLines.Count) {
            $line = $sourceLines[$lineNum - 1]
            $ref = $line.Substring(0, [Math]::Min(60, $line.Length))
        }

        $commentText = ($c.text -replace "`n", "\n")

        if ($AsJson) {
            $results += @{
                file = $relPath; line = $lineNum; status = $status
                anchor = $anchor; reference = $ref; comment = $c.text
                id = $c.id; responses = @($c.responses)
            }
        } else {
            $results += "$relPath`t$lineNum`t$status`t$anchor`t$ref`t$commentText"
        }
    }
}

if ($AsJson) {
    $results | ConvertTo-Json -Depth 10
} else {
    if ($results.Count -gt 0) {
        Write-Output "FILE`tLINE`tSTATUS`tANCHOR`tREFERENCE`tCOMMENT"
    }
    $results | ForEach-Object { Write-Output $_ }
}

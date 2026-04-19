#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Add responses to review comments.
.PARAMETER File
    Path to the reviewed file (not the sidecar)
.PARAMETER Id
    Comment ID to respond to
.PARAMETER Author
    Response author name
.PARAMETER Text
    Response text
.PARAMETER FromJson
    Path to JSON file with batch responses [{id, text}]
#>
param(
    [Parameter(Mandatory)][string]$File,
    [string]$Id,
    [Parameter(Mandatory)][string]$Author,
    [string]$Text,
    [string]$FromJson
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

function Add-Response {
    param([string]$SidecarPath, [string]$CommentId, [string]$AuthorName, [string]$ResponseText)
    $data = Get-Content -Path $SidecarPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $found = $false
    foreach ($c in $data.comments) {
        if ($c.id -eq $CommentId) {
            if (-not $c.responses) {
                $c | Add-Member -NotePropertyName responses -NotePropertyValue @()
            }
            $response = @{
                author = $AuthorName
                text = $ResponseText
                createdAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            $c.responses += $response
            $found = $true
            break
        }
    }
    if (-not $found) {
        Write-Error "ERROR: comment $CommentId not found in $SidecarPath"
        return $false
    }
    Write-Atomic -Path $SidecarPath -Data $data
    return $true
}

$sidecar = "$File.review.json"
if (-not (Test-Path $sidecar)) {
    Write-Error "ERROR: $sidecar not found"
    exit 1
}

if ($FromJson) {
    $responses = Get-Content -Path $FromJson -Raw -Encoding UTF8 | ConvertFrom-Json
    $allOk = $true
    foreach ($r in $responses) {
        if (-not (Add-Response -SidecarPath $sidecar -CommentId $r.id -AuthorName $Author -ResponseText $r.text)) {
            $allOk = $false
        }
    }
    if (-not $allOk) { exit 1 }
} elseif ($Id -and $Text) {
    if (-not (Add-Response -SidecarPath $sidecar -CommentId $Id -AuthorName $Author -ResponseText $Text)) {
        exit 1
    }
} else {
    Write-Error "Provide -Id and -Text, or -FromJson"
    exit 1
}

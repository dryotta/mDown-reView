#Requires -Version 5.1
<#
.SYNOPSIS
    Installs the latest version of mdownreview on Windows.
.DESCRIPTION
    Downloads the latest mdownreview installer from GitHub Releases,
    extracts it, and runs the NSIS setup in silent mode (current-user install).
.EXAMPLE
    powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"
#>

$ErrorActionPreference = 'Stop'

$AppName = 'mdownreview'
$GitHubRepo = 'dryotta/mdownreview'

function Get-Architecture {
    try {
        $a = [System.Reflection.Assembly]::LoadWithPartialName("System.Runtime.InteropServices.RuntimeInformation")
        $t = $a.GetType("System.Runtime.InteropServices.RuntimeInformation")
        $p = $t.GetProperty("OSArchitecture")
        switch ($p.GetValue($null).ToString()) {
            "X64"   { return "x64" }
            "Arm64" { return "arm64" }
            default { throw "Unsupported architecture: $_" }
        }
    } catch {
        # Fallback for older PowerShell
        $arch = $env:PROCESSOR_ARCHITECTURE
        if ($arch -eq "AMD64") {
            return "x64"
        } elseif ($arch -eq "ARM64") {
            return "arm64"
        } else {
            throw "Unsupported architecture: $arch"
        }
    }
}

function Install-Mdownreview {
    Write-Host "Detecting architecture..."
    $arch = Get-Architecture
    Write-Host "  Architecture: $arch"

    Write-Host "Fetching latest release..."
    $releaseUrl = "https://api.github.com/repos/$GitHubRepo/releases/latest"
    $release = Invoke-RestMethod -Uri $releaseUrl -UseBasicParsing
    $tag = $release.tag_name
    $version = $tag.TrimStart('v')
    Write-Host "  Latest version: $version"

    $fileName = "$AppName-$version-windows-$arch.zip"
    $downloadUrl = "https://github.com/$GitHubRepo/releases/download/$tag/$fileName"

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "$AppName-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        $zipPath = Join-Path $tempDir $fileName
        Write-Host "Downloading $fileName..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

        Write-Host "Extracting..."
        Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

        # Find the setup exe inside the extracted files
        $setupExe = Get-ChildItem -Path $tempDir -Filter "*setup*.exe" -Recurse | Select-Object -First 1
        if (-not $setupExe) {
            $setupExe = Get-ChildItem -Path $tempDir -Filter "*.exe" -Recurse | Select-Object -First 1
        }
        if (-not $setupExe) {
            throw "No installer executable found in the downloaded archive."
        }

        Write-Host "Running installer silently..."
        $process = Start-Process -FilePath $setupExe.FullName -ArgumentList '/S' -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "Installer exited with code $($process.ExitCode)."
        }

        Write-Host ""
        Write-Host "Done! $AppName $version has been installed." -ForegroundColor Green
        Write-Host "  You can launch it from the Start Menu or by searching for '$AppName'."
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Install-Mdownreview

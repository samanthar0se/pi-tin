[CmdletBinding()]
param(
    [switch]$InstallPrerequisites,
    [switch]$SkipTests,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Test-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"

    $cargoBin = Join-Path $HOME ".cargo\bin"
    if (Test-Path $cargoBin) {
        $env:Path = "$cargoBin;$env:Path"
    }
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [string[]]$ExtraArguments = @()
    )

    Write-Step "Installing $Id"
    $arguments = @(
        "install", "--id", $Id, "--exact",
        "--accept-package-agreements", "--accept-source-agreements"
    ) + $ExtraArguments
    Invoke-Checked "winget" @arguments
}

if ($env:OS -ne "Windows_NT") {
    throw "This script builds the Windows executable and must run on Windows."
}

$repoRoot = $PSScriptRoot
Set-Location $repoRoot

Write-Host "Pi Remote Windows Builder" -ForegroundColor Green
Write-Host "Repository: $repoRoot"

if ($InstallPrerequisites) {
    if (-not (Test-Command "winget")) {
        throw "winget is required for -InstallPrerequisites. Install App Installer from the Microsoft Store, or install the prerequisites manually."
    }

    if (-not (Test-Command "node")) {
        Install-WingetPackage "OpenJS.NodeJS.LTS"
        Refresh-Path
    }

    if (-not (Test-Command "rustup") -and -not (Test-Command "cargo")) {
        Install-WingetPackage "Rustlang.Rustup"
        Refresh-Path
        Invoke-Checked "rustup" "default" "stable-msvc"
    }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere) -and -not (Test-Command "cl.exe")) {
        Install-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" @(
            "--override",
            "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
        )
        Refresh-Path
    }
}

$missing = @()
if (-not (Test-Command "node")) { $missing += "Node.js 22+ (https://nodejs.org/)" }
if (-not (Test-Command "corepack")) { $missing += "Corepack (included with Node.js)" }
if (-not (Test-Command "cargo")) { $missing += "Rust stable-msvc (https://rustup.rs/)" }

if ($missing.Count -gt 0) {
    Write-Host "`nMissing build prerequisites:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" }
    Write-Host "`nRe-run from an elevated PowerShell with -InstallPrerequisites, or install them manually."
    exit 1
}

$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) {
    throw "Node.js 22 or newer is required. Detected: $(node --version)"
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if ((Test-Path $vswhere) -and -not (Test-Command "cl.exe")) {
    $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installationPath) {
        Write-Warning "MSVC C++ Build Tools were not detected. Install the Visual Studio Desktop development with C++ workload if the Rust build fails."
    }
} elseif (-not (Test-Path $vswhere) -and -not (Test-Command "cl.exe")) {
    Write-Warning "Could not verify MSVC C++ Build Tools. Install the Visual Studio Desktop development with C++ workload if the Rust build fails."
}

Write-Step "Activating the repository's pnpm version"
Invoke-Checked "corepack" "prepare" "pnpm@10.14.0" "--activate"

if ($Clean) {
    Write-Step "Removing previous build output"
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "apps\desktop\dist"
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "apps\desktop\src-tauri\target"
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "artifacts"
}

Write-Step "Installing JavaScript dependencies"
Invoke-Checked "corepack" "pnpm" "install" "--frozen-lockfile"

if (-not $SkipTests) {
    Write-Step "Running focused tests"
    Invoke-Checked "corepack" "pnpm" "test"

    Write-Step "Type-checking all packages"
    Invoke-Checked "corepack" "pnpm" "typecheck"
}

Write-Step "Building the Windows NSIS executable"
Invoke-Checked "corepack" "pnpm" "--filter" "@pi-remote/desktop" "tauri" "build" "--bundles" "nsis"

$bundleDirectory = Join-Path $repoRoot "apps\desktop\src-tauri\target\release\bundle\nsis"
$executables = @(Get-ChildItem -Path $bundleDirectory -Filter "*.exe" -File -ErrorAction SilentlyContinue)
if ($executables.Count -eq 0) {
    throw "Tauri finished, but no NSIS executable was found in $bundleDirectory"
}

$artifactDirectory = Join-Path $repoRoot "artifacts"
New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
foreach ($executable in $executables) {
    Copy-Item $executable.FullName -Destination $artifactDirectory -Force
}

Write-Host "`nBuild complete." -ForegroundColor Green
Write-Host "Executable(s):"
Get-ChildItem -Path $artifactDirectory -Filter "*.exe" -File | ForEach-Object {
    Write-Host "  $($_.FullName)" -ForegroundColor Yellow
}

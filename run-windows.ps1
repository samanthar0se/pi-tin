[CmdletBinding()]
param(
    [switch]$StopOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot

function Stop-ProcessTree {
    param([int]$ProcessId)

    & taskkill.exe /PID $ProcessId /T /F *> $null
}

function Stop-RunningDesktop {
    Write-Host "Stopping any previous Pi Tin development app..." -ForegroundColor Cyan

    $desktopProcesses = @(Get-Process -Name "Pi-Tin-portable", "pi-tin", "Pi-Remote-portable" -ErrorAction SilentlyContinue)
    foreach ($desktopProcess in $desktopProcesses) {
        Stop-ProcessTree $desktopProcess.Id
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 250
        $listeners = @(Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 0) {
            return
        }

        foreach ($processId in @($listeners.OwningProcess | Select-Object -Unique)) {
            $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
            if ($owner -and $owner.CommandLine -and $owner.CommandLine.IndexOf($PSScriptRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                Stop-ProcessTree $processId
            }
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    $listener = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $owner = if ($listener) { Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue } else { $null }
    $ownerDescription = if ($owner) { "$($owner.Name) (PID $($owner.ProcessId))" } else { "another process" }
    throw "Port 1420 is still occupied by $ownerDescription. Close that process, then run this script again."
}

if (-not $StopOnly) {
    foreach ($command in "git", "corepack", "cargo") {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "$command is required but was not found in PATH. See the Windows prerequisites in README.md."
        }
    }
}

Stop-RunningDesktop

if ($StopOnly) {
    return
}

corepack prepare pnpm@10.14.0 --activate
if ($LASTEXITCODE -ne 0) { throw "Could not activate pnpm." }

corepack pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Could not install dependencies." }

$env:VITE_BUILD_REVISION = (git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not determine the current Git revision." }
Write-Host "Starting Pi Tin from revision $env:VITE_BUILD_REVISION" -ForegroundColor Green

corepack pnpm --filter @pi-tin/desktop tauri dev
if ($LASTEXITCODE -ne 0) { throw "Pi Tin development app exited with an error." }

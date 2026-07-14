[CmdletBinding()]
param(
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot

if ($env:OS -ne "Windows_NT") {
    throw "This startup shortcut is supported only on Windows."
}

$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
if (-not $startupDirectory) {
    throw "Could not locate the current user's Windows Startup folder."
}

$shortcutPath = Join-Path $startupDirectory "Pi Tin Host.lnk"
if ($Remove) {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
    Write-Host "Removed Pi Tin host startup shortcut: $shortcutPath" -ForegroundColor Green
    return
}

$launcherPath = Join-Path $PSScriptRoot "start-host-windows.ps1"
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "Host launcher not found at $launcherPath."
}

$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = "$powershellPath,0"
$shortcut.Description = "Start the Pi Tin host in the interactive Windows desktop session"
$shortcut.Save()

Write-Host "Installed Pi Tin host startup shortcut: $shortcutPath" -ForegroundColor Green
Write-Host "The foreground host will start after this user signs in to Windows." -ForegroundColor Green

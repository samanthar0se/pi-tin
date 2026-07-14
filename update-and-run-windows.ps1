[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required but was not found in PATH."
}

$insideWorkTree = (& git rev-parse --is-inside-work-tree 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $insideWorkTree -ne "true") {
    throw "$PSScriptRoot is not a Git working tree. Run this script from a clone of the Pi Tin repository."
}

$upstream = (& git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $upstream) {
    throw "The current branch has no upstream branch. Configure one before updating."
}

Write-Host "Fetching Pi Tin updates from $upstream..." -ForegroundColor Cyan
git fetch --prune
if ($LASTEXITCODE -ne 0) { throw "Could not fetch repository updates. Check the network and Git credentials." }

$trackedChanges = @(git status --short --untracked-files=no)
if ($LASTEXITCODE -ne 0) { throw "Could not inspect the repository status." }
if ($trackedChanges.Count -gt 0) {
    throw "The repository has local tracked changes. Commit or discard them before updating:`n$($trackedChanges -join "`n")"
}

$revisionCounts = (git rev-list --left-right --count "HEAD...$upstream") -split '\s+'
if ($LASTEXITCODE -ne 0 -or $revisionCounts.Count -ne 2) {
    throw "Could not compare the current branch with $upstream."
}

$aheadCount = [int]$revisionCounts[0]
$behindCount = [int]$revisionCounts[1]
if ($aheadCount -gt 0) {
    throw "The local branch is $aheadCount commit(s) ahead of $upstream. Push or remove those commits before using the client updater."
}

& "$PSScriptRoot\run-windows.ps1" -StopOnly

if ($behindCount -gt 0) {
    Write-Host "Applying $behindCount update commit(s)..." -ForegroundColor Cyan
    git merge --ff-only $upstream
    if ($LASTEXITCODE -ne 0) { throw "Could not fast-forward the repository to $upstream." }
} else {
    Write-Host "Repository is already current." -ForegroundColor DarkGray
}

$revision = (git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not determine the updated Git revision." }
Write-Host "Pi Tin source is now at revision $revision." -ForegroundColor Green

& "$PSScriptRoot\run-windows.ps1"

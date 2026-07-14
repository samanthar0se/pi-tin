[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot

node .\start-host.mjs
if ($LASTEXITCODE -ne 0) {
    throw "Pi Tin host exited with code $LASTEXITCODE."
}

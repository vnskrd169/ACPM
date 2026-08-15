$ErrorActionPreference = 'Stop'
$ProjectId = 'acpm-project-system-qa'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host "Configuring ACPM staging authentication -> $ProjectId" -ForegroundColor Yellow
firebase.cmd deploy --only auth --project $ProjectId --config firebase.auth.staging.json
if ($LASTEXITCODE -ne 0) { throw 'Staging authentication configuration failed.' }

Write-Host 'Staging Email/Password and Google authentication are enabled.' -ForegroundColor Green

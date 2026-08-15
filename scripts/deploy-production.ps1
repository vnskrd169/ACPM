param(
  [switch]$ConfirmProduction,
  [switch]$IncludeDatabase
)

$ErrorActionPreference = 'Stop'
$ProjectId = 'acpm-project-system'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

if (-not $ConfirmProduction) {
  throw 'Production deploy blocked. Run scripts/deploy-production.ps1 -ConfirmProduction after staging QA passes.'
}

Write-Host "ACPM PRODUCTION deployment -> $ProjectId" -ForegroundColor Red
node scripts/environment_static_qa.js
if ($LASTEXITCODE -ne 0) { throw 'Environment isolation QA failed.' }
node scripts/pwa_cache_static_qa.js
if ($LASTEXITCODE -ne 0) { throw 'PWA cache QA failed.' }
node scripts/rc1_static_gate.js
if ($LASTEXITCODE -ne 0) { throw 'RC1 static gate failed.' }

$Target = if ($IncludeDatabase) { 'database,hosting' } else { 'hosting' }
firebase.cmd deploy --only $Target --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw 'Production deployment failed.' }

Write-Host 'Production deployment complete: https://acpm-project-system.web.app' -ForegroundColor Green

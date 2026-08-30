param(
  [switch]$HostingOnly,
  [switch]$IncludeAiProvider
)

$ErrorActionPreference = 'Stop'
$ProjectId = 'acpm-project-system-qa'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host "ACPM staging deployment -> $ProjectId" -ForegroundColor Yellow
node scripts/environment_static_qa.js
if ($LASTEXITCODE -ne 0) { throw 'Environment isolation QA failed.' }
node scripts/pwa_cache_static_qa.js
if ($LASTEXITCODE -ne 0) { throw 'PWA cache QA failed.' }
node scripts/rc1_static_gate.js
if ($LASTEXITCODE -ne 0) { throw 'RC1 static gate failed.' }

if ($IncludeAiProvider) {
  throw 'AI Functions deployment blocked: enable Firebase billing, configure and validate Web App Check for the decision and action-draft callables, then replace this release guard in a reviewed change.'
}

$Target = if ($HostingOnly) {
  'hosting'
} else {
  'database,hosting'
}
firebase.cmd deploy --only $Target --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw 'Staging deployment failed.' }

Write-Host 'Staging deployment complete: https://acpm-project-system-qa.web.app' -ForegroundColor Green

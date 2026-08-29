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

$Target = if ($HostingOnly) {
  'hosting'
} elseif ($IncludeAiProvider) {
  node scripts/ai_security_static_qa.js
  if ($LASTEXITCODE -ne 0) { throw 'AI security static QA failed.' }
  npm.cmd --prefix functions run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'AI Functions typecheck failed.' }
  npm.cmd --prefix functions test
  if ($LASTEXITCODE -ne 0) { throw 'AI Functions tests failed.' }
  'database,hosting,functions:ai-staging'
} else {
  'database,hosting'
}
firebase.cmd deploy --only $Target --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw 'Staging deployment failed.' }

Write-Host 'Staging deployment complete: https://acpm-project-system-qa.web.app' -ForegroundColor Green

<#
.SYNOPSIS
Windows equivalent of scripts/compose-smoke.sh.

.DESCRIPTION
Checks a running compose stack end to end: migrations applied, API healthy,
the web page reaching the API from inside its container, a signed-out redirect,
the demo scenario, an anonymous refusal, operator sign-in, event ingestion, the
worker running a job, correlation, investigation, approval, verified recovery,
and the live stream carrying the verification.

Run it against the stack compose started, with SEED_OPERATOR_PASSWORD set to
the password that stack was seeded with.

curl.exe is used rather than Invoke-WebRequest so the HTTP semantics (status
codes, redirect URLs, cookie jar, raw streaming) match the bash script exactly.
#>

$ErrorActionPreference = 'Stop'

param_missing_guard {
  if (-not $env:SEED_OPERATOR_PASSWORD) {
    Write-Host 'FAILED: set SEED_OPERATOR_PASSWORD (the one compose seeded)' -ForegroundColor Red
    exit 1
  }
}
param_missing_guard

$ApiUrl = if ($env:API_URL) { $env:API_URL } else { 'http://localhost:4000' }
$WebUrl = if ($env:WEB_URL) { $env:WEB_URL } else { 'http://localhost:3000' }
$Operator = if ($env:SEED_OPERATOR_USERNAME) { $env:SEED_OPERATOR_USERNAME } else { 'operator' }
$Attempts = if ($env:SMOKE_ATTEMPTS) { [int]$env:SMOKE_ATTEMPTS } else { 60 }

$jar = [System.IO.Path]::GetTempFileName()
$tmp = [System.IO.Path]::GetTempFileName()

function Cleanup {
  Remove-Item -LiteralPath $jar, $tmp -Force -ErrorAction SilentlyContinue
}
trap { Cleanup; break }

function Ok($label) { Write-Host "ok: $label" }
function Failed($label) { Write-Host "FAILED: $label" -ForegroundColor Red; Cleanup; exit 1 }

# Runs a native command, returns stdout, and sets $script:LastCode.
function Run($exe, $argv) {
  $output = & $exe @argv 2>&1
  $script:LastCode = $LASTEXITCODE
  return ($output | Out-String)
}

# Polls until the probe succeeds; containers need a few seconds to boot.
function Wait-For($label, [scriptblock]$probe) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    if (& $probe) { Ok $label; return $true }
    Start-Sleep -Seconds 2
  }
  Failed $label
  return $false
}

# A GET that must succeed and contain a pattern. Returns the body.
function Get-Body($url, $withJar) {
  $argv = @('-s', '-f')
  if ($withJar) { $argv += @('-b', $jar) }
  $argv += $url
  $body = Run 'curl.exe' $argv
  if ($script:LastCode -ne 0) { return $null }
  return $body
}

# --- migrations -------------------------------------------------------------

$migrateExit = (Run 'docker' @('compose', 'ps', '-a', 'migrate', '--format', '{{.ExitCode}}')).Trim()
if ($migrateExit -ne '0') { Failed "migrate exited $migrateExit" }
Ok 'migrations applied'

# --- health and the web page -----------------------------------------------

Wait-For 'api /health reports ok' {
  $h = Get-Body "$ApiUrl/health" $false
  $h -and ($h -match '"status":"ok"')
}

# React splits the text with a comment marker, hence the optional <!-- -->.
Wait-For 'web login page shows API ok' {
  $p = Get-Body "$WebUrl/login" $false
  $p -and ($p -match 'API: (<!-- -->)?ok')
}

# Signed out, every dashboard page redirects to login.
$redirect = Run 'curl.exe' @('-s', '-o', 'NUL', '-w', '%{redirect_url}', "$WebUrl/incidents')
$redirect = ($redirect | Out-String).Trim()
if ($redirect -like '*/login') { Ok 'signed-out dashboard redirects to login' }
else { Failed "/incidents signed out went to '$redirect'" }

# --- the demo scenario ------------------------------------------------------

$demoStatus = Run 'curl.exe' @('-s', '-o', $tmp, '-w', '%{http_code}', '-X', 'POST',
  '-H', 'content-type: application/json', '-d', '{"seed":42}',
  "$ApiUrl/api/demo/scenarios/training-event")
$demoStatus = ($demoStatus | Out-String).Trim()
if ($demoStatus -in @('200', '201')) { Ok "demo scenario ran ($demoStatus)" }
else {
  Write-Host (Get-Content -LiteralPath $tmp -Raw) -ForegroundColor Red
  Failed "demo scenario returned $demoStatus"
}

# Everything below /api needs a session; without one the API must refuse.
$anon = Run 'curl.exe' @('-s', '-o', 'NUL', '-w', '%{http_code}', "$ApiUrl/api/labs")
$anon = ($anon | Out-String).Trim()
if ($anon -eq '401') { Ok 'protected routes refuse anonymous requests' }
else { Failed "/api/labs without a session returned $anon" }

# Body on stdin, not argv, so the password never shows up in the process list.
$login = @{ username = $Operator; password = $env:SEED_OPERATOR_PASSWORD } | ConvertTo-Json -Compress
$login | curl.exe -fs -c $jar -o NUL -X POST -H 'content-type: application/json' --data-binary '@-' "$ApiUrl/api/auth/login"
if ($LASTEXITCODE -ne 0) { Failed 'operator sign-in' }
Ok 'operator signed in'

# --- ingestion --------------------------------------------------------------

# A fresh run fails 19 of the 40 labs. A re-run replays the scenario (200)
# after an earlier run may have recovered some, so it only checks they exist.
if ($demoStatus -eq '201') {
  $labs = Get-Body "$ApiUrl/api/labs?status=failed&limit=100" $true
  $failed = ([regex]::Matches($labs, '"status":"failed"')).Count
  if ($failed -ge 19) { Ok "events ingested, $failed labs failed" }
  else { Failed "expected >= 19 failed labs, got $failed" }
}
else {
  $summary = Get-Body "$ApiUrl/api/labs/summary" $true
  $total = 0
  foreach ($m in [regex]::Matches($summary, '\d+')) { $total += [int]$m.Value }
  if ($total -ge 40) { Ok "scenario replayed, $total labs present" }
  else { Failed "expected the scenario's 40 labs, got $total" }
}

# --- the worker -------------------------------------------------------------

# A real failure event arms a correlate job; the worker container must run it.
$stamp = [DateTime]::UtcNow.ToUnixTimeSeconds()
$event = @"
{"providerEventId":"smoke-$stamp","labId":"sim-training-event-42-lab-01",
 "type":"provision_failed","errorCategory":"PROVISION_TIMEOUT",
 "message":"smoke test","occurredAt":"$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))",
 "source":"simulated"}
"@
$eventResponse = Run 'curl.exe' @('-s', '-f', '-b', $jar, '-X', 'POST',
  '-H', 'content-type: application/json', '-d', $event, "$ApiUrl/api/events")
if ($script:LastCode -ne 0) { Failed 'event ingestion' }

$jobId = [regex]::Match($eventResponse, '"jobId":"([^"]*)"').Groups[1].Value
if (-not $jobId) {
  Write-Host $eventResponse -ForegroundColor Red
  Failed 'no job armed'
}

Wait-For "worker ran job $jobId" {
  $j = Get-Body "$ApiUrl/api/jobs/$jobId" $true
  $j -and ($j -match '"status":"succeeded"')
}

# Correlation ran in the worker: the scenario's 12-timeout burst is one incident.
Wait-For 'scenario burst correlated into one incident' {
  $i = Get-Body "$ApiUrl/api/incidents?severity=high&limit=100" $true
  $i -and ($i -match '"labCount":12')
}

# The worker investigates that incident with the fixture provider (never a live
# model). On a re-run the incident is already past investigation (409), so the
# check is that a completed investigation exists either way.
$incidents = Get-Body "$ApiUrl/api/incidents?severity=high&limit=100" $true
$incidentId = $null
foreach ($chunk in ($incidents -split '}')) {
  if ($chunk -match '"labCount":12') {
    $m = [regex]::Match($chunk, '"id":"([^"]*)"')
    if ($m.Success) { $incidentId = $m.Groups[1].Value; break }
  }
}
if (-not $incidentId) { Failed 'no 12-lab incident to investigate' }

$investigate = (Run 'curl.exe' @('-s', '-b', $jar, '-o', 'NUL', '-w', '%{http_code}',
  '-X', 'POST', "$ApiUrl/api/incidents/$incidentId/investigate')) | Out-String
$investigate = $investigate.Trim()
if ($investigate -in @('200', '202', '409')) { Ok "investigation requested ($investigate)" }
else { Failed "investigate returned $investigate" }

Wait-For 'worker completed the investigation' {
  $inv = Get-Body "$ApiUrl/api/incidents/$incidentId/investigations" $true
  $inv -and ($inv -match '"status":"completed"')
}

# --- approval and verified recovery ----------------------------------------

# A fresh diagnosis is judged by policy in the same transaction: the scenario's
# PROVISION_TIMEOUT burst must be awaiting approval. A re-run (409 above) is
# checking an incident an earlier run already handled, so it is skipped.
if ($investigate -eq '202') {
  Wait-For 'policy allowed the recommended retry, awaiting approval' {
    $r = Get-Body "$ApiUrl/api/incidents/$incidentId/recovery-actions" $true
    $r -and ($r -match '"status":"awaiting_approval"')
  }

  $actions = Get-Body "$ApiUrl/api/incidents/$incidentId/recovery-actions" $true
  $actionId = [regex]::Match($actions, '"id":"([^"]*)"').Groups[1].Value
  if (-not $actionId) { Failed 'no recovery action to approve' }

  # Watch the live stream through the web relay (cookies ignore ports, so the
  # API session in the jar reaches the web origin too).
  $stream = [System.IO.Path]::GetTempFileName()
  $streamProc = Start-Process -FilePath 'curl.exe' -WindowStyle Hidden -PassThru -ArgumentList @(
    '-s', '-N', '-b', $jar, '--max-time', '40', "$WebUrl/api/events/stream"
  ) -RedirectStandardOutput $stream

  $approve = (Run 'curl.exe' @('-s', '-b', $jar, '-o', 'NUL', '-w', '%{http_code}',
    '-X', 'POST', "$ApiUrl/api/recovery-actions/$actionId/approve")) | Out-String
  $approve = $approve.Trim()
  if ($approve -ne '202') { Failed "approve returned $approve" }
  Ok 'operator approved the retry'

  Wait-For 'worker verified recovery and resolved the incident' {
    $r = Get-Body "$ApiUrl/api/incidents/$incidentId" $true
    $r -and ($r -match '"status":"resolved"')
  }

  Wait-For 'the live stream delivered the verification' {
    (Get-Content -LiteralPath $stream -Raw -ErrorAction SilentlyContinue) -match 'recovery.verified'
  }

  Stop-Process -Id $streamProc.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stream -Force -ErrorAction SilentlyContinue
}
else {
  Write-Host 'skip: proposal check (incident handled by an earlier run)'
}

Cleanup
Write-Host 'smoke passed'
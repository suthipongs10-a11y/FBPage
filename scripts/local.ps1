param([ValidateSet('start', 'stop', 'status', 'services')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateDir = Join-Path $projectRoot '.local-data'
$manifest = Join-Path $stateDir 'app-processes.json'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
function Read-ManagedEntries {
  if (!(Test-Path -LiteralPath $manifest)) { return }
  Expand-ManagedEntries (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
}
function Expand-ManagedEntries($Entries) {
  foreach ($candidate in $Entries) {
    if ($candidate -is [array]) { Expand-ManagedEntries $candidate }
    elseif ($candidate.value) { Expand-ManagedEntries $candidate.value }
    elseif ($candidate.id -and $candidate.marker -and $candidate.startedTicks) { Write-Output $candidate }
  }
}
function Is-Listening([int]$Port) {
  $probe = [Net.Sockets.TcpClient]::new()
  try { return $probe.ConnectAsync('127.0.0.1', $Port).Wait(500) -and $probe.Connected } catch { return $false } finally { $probe.Dispose() }
}
if ($Action -eq 'status') {
  [pscustomobject]@{ Web = (Is-Listening 3000); Api = (Is-Listening 4000); Postgres = (Is-Listening 55432); Redis = (Is-Listening 56379) } | Format-Table | Out-String | Write-Output
  exit
}
if ($Action -eq 'stop') {
  if (Test-Path -LiteralPath $manifest) {
    foreach ($entry in @(Read-ManagedEntries)) {
      if (!$entry.id -or !$entry.marker) { continue }
      $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.id)" -ErrorAction SilentlyContinue
      $started = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
      if ($running -and $running.Name -eq 'node.exe' -and $running.CommandLine.Contains($entry.marker) -and $started.StartTime.ToUniversalTime().Ticks -eq $entry.startedTicks) { Stop-Process -Id $entry.id }
    }
    Set-Content -LiteralPath $manifest -Value '[]' -Encoding UTF8
  }
  Write-Output 'Stopped managed app processes. PostgreSQL, Redis and data are retained.'
  exit
}
if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) { throw 'Create root .env first; see docs/LOCAL_SETUP.md.' }
if ($Action -eq 'start' -and !(Test-Path -LiteralPath (Join-Path $projectRoot 'apps/api/dist/main.js'))) { throw 'Run pnpm build first.' }
if (!(Is-Listening 55432)) {
  $pgCtl = Join-Path $projectRoot '.local-tools/postgres/package/native/bin/pg_ctl.exe'
  if (!(Test-Path -LiteralPath $pgCtl)) { throw 'Portable PostgreSQL unavailable. Use the standard Docker/manual setup in docs/LOCAL_SETUP.md.' }
  $pgArgs = @('-D', ('"' + (Join-Path $stateDir 'postgres') + '"'), '-l', ('"' + (Join-Path $stateDir 'postgres.log') + '"'), '-o', '"-h 127.0.0.1 -p 55432"', '-w', 'start')
  $pgStart = Start-Process -FilePath $pgCtl -ArgumentList $pgArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'pgctl.out.log') -RedirectStandardError (Join-Path $stateDir 'pgctl.err.log')
  # Wait only for pg_ctl; Start-Process -Wait also waits for the long-running database child.
  $pgStart.WaitForExit()
  # Windows PowerShell can return a null ExitCode for a detached process.
  # Ask PostgreSQL itself instead of mistaking a successful startup for failure.
  $pgReady = Join-Path (Split-Path $pgCtl) 'pg_isready.exe'
  & $pgReady -h 127.0.0.1 -p 55432 -q
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not start; inspect .local-data/postgres.log.' }
}
if (!(Is-Listening 56379)) {
  $redisExe = Join-Path $projectRoot '.local-tools/redis/Redis-7.4.9-Windows-x64-msys2/redis-server.exe'
  if (!(Test-Path -LiteralPath $redisExe)) { throw 'Portable Redis unavailable. Use the standard Docker/manual setup in docs/LOCAL_SETUP.md.' }
  Start-Process -FilePath $redisExe -ArgumentList @('--bind', '127.0.0.1', '--port', '56379', '--appendonly', 'yes') -WorkingDirectory $stateDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'redis.out.log') -RedirectStandardError (Join-Path $stateDir 'redis.err.log') | Out-Null
  for ($i = 0; $i -lt 20 -and !(Is-Listening 56379); $i++) { Start-Sleep -Milliseconds 250 }
  if (!(Is-Listening 56379)) { throw 'Redis did not start; inspect .local-data/redis.err.log.' }
}
if ($Action -eq 'services') { Write-Output 'Local PostgreSQL and Redis are ready.'; exit }
$nodePath = (Get-Command node).Source
$targets = @(
  @{ name = 'api'; port = 4000; marker = 'apps/api/dist/main.js'; args = @('--env-file=.env', 'apps/api/dist/main.js') },
  @{ name = 'web'; port = 3000; marker = 'apps/web/node_modules/next/dist/bin/next'; args = @('--env-file=.env', 'apps/web/node_modules/next/dist/bin/next', 'start', 'apps/web', '-p', '3000') },
  @{ name = 'worker'; port = 0; marker = 'workers/scheduler/dist/main.js'; args = @('--env-file=.env', 'workers/scheduler/dist/main.js') }
)
$managed = @()
$managed = @(Read-ManagedEntries)
foreach ($target in $targets) {
  $existing = $managed | Where-Object { $_.name -eq $target.name } | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.id)" -ErrorAction SilentlyContinue } | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($target.marker) }
  if ($existing) { continue }
  if ($target.port -and (Is-Listening $target.port)) { throw "Port $($target.port) is occupied. Stop its server before starting the local app." }
  $child = Start-Process -FilePath $nodePath -ArgumentList $target.args -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir "$($target.name).out.log") -RedirectStandardError (Join-Path $stateDir "$($target.name).err.log")
  $managed = @($managed | Where-Object { $_.name -ne $target.name }) + @([pscustomobject]@{ name = $target.name; id = $child.Id; marker = $target.marker; startedTicks = $child.StartTime.ToUniversalTime().Ticks })
  ConvertTo-Json -InputObject @($managed) | Set-Content -LiteralPath $manifest -Encoding UTF8
}
Write-Output 'Local app starting: http://localhost:3000. Logs: .local-data. No live credentials are configured by this script.'

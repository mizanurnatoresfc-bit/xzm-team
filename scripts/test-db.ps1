# Windows twin of scripts/test-db.sh: runs all migrations + SQL tests against a
# THROWAWAY database on a local PostgreSQL. Never point this at production.
#
#   powershell -ExecutionPolicy Bypass -File scripts\test-db.ps1 -PgBin C:\path\to\pgsql\bin
#
# If no server answers on the port, a private one is initialised and started in
# -DataDir (default: next to the binaries) and left running; stop it with
#   <PgBin>\pg_ctl.exe -D <DataDir> stop
param(
  [Parameter(Mandatory = $true)][string]$PgBin,
  [int]$Port = 54329,
  [string]$DataDir = (Join-Path (Split-Path (Split-Path $PgBin)) 'data'),
  [string]$Database = 'xzm_team_test',
  [string]$Only = ''          # e.g. -Only 80  runs just tests\80_*.sql
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$env:PGHOST = '127.0.0.1'; $env:PGPORT = "$Port"; $env:PGUSER = 'postgres'; $env:PGCLIENTENCODING = 'UTF8'

function Invoke-Pg([string]$exe, [string[]]$argList) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $PgBin $exe
  $psi.Arguments = ($argList | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  [pscustomobject]@{ Code = $p.ExitCode; Out = ($out + $errTask.Result) }
}
function Invoke-Sql([string]$dbName, [string[]]$more) {
  Invoke-Pg 'psql.exe' (@('-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', $dbName) + $more)
}

if ((Invoke-Pg 'pg_isready.exe' @()).Code -ne 0) {
  if (-not (Test-Path (Join-Path $DataDir 'PG_VERSION'))) {
    $r = Invoke-Pg 'initdb.exe' @('-D', $DataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C')
    if ($r.Code -ne 0) { throw "initdb failed: $($r.Out)" }
  }
  # no -Wait: Start-Process -Wait would also wait for the server process itself
  Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') -WindowStyle Hidden `
    -ArgumentList @('-D', "`"$DataDir`"", '-l', "`"$(Join-Path $DataDir 'server.log')`"", '-o', "`"-p $Port -c listen_addresses=127.0.0.1`"", 'start')
  $up = $false
  foreach ($i in 1..30) { if ((Invoke-Pg 'pg_isready.exe' @()).Code -eq 0) { $up = $true; break }; Start-Sleep -Seconds 1 }
  if (-not $up) { throw "PostgreSQL did not start; see $DataDir\server.log" }
}

$r = Invoke-Sql 'postgres' @('-c', "drop database if exists $Database", '-c', "create database $Database")
if ($r.Code -ne 0) { throw "could not create database: $($r.Out)" }
# Start in UTC like a Supabase project, so tests prove the time zone migration works.
$r = Invoke-Sql 'postgres' @('-c', "alter database $Database set timezone to 'UTC'")
if ($r.Code -ne 0) { throw "could not set test database time zone: $($r.Out)" }
$setup = @(Join-Path $root 'supabase\tests\local_supabase_shim.sql') +
         @(Get-ChildItem (Join-Path $root 'supabase\migrations\*.sql') | Sort-Object Name | ForEach-Object FullName) +
         @(Join-Path $root 'supabase\tests\00_helpers.sql')
foreach ($f in $setup) {
  $r = Invoke-Sql $Database @('-f', $f)
  if ($r.Code -ne 0) { Write-Output "SETUP FAILED  $(Split-Path $f -Leaf)"; Write-Output $r.Out; exit 2 }
  Write-Output "applied: $(Split-Path $f -Leaf)"
}

$pass = 0; $failed = 0
foreach ($f in (Get-ChildItem (Join-Path $root 'supabase\tests\[1-9]*.sql') | Sort-Object Name)) {
  if ($Only -and -not $f.Name.StartsWith($Only)) { continue }
  $r = Invoke-Sql $Database @('-f', $f.FullName)
  $n = ([regex]::Matches($r.Out, 'PASS:')).Count
  $pass += $n
  if ($r.Code -ne 0) {
    $failed++
    Write-Output "FAILED  $($f.Name)  ($n passed before failure)"
    ($r.Out -split "`n" | Where-Object { $_ -match 'ERROR|FAIL|CONTEXT|DETAIL' } | Select-Object -First 8) | Write-Output
  } else {
    Write-Output "ok      $($f.Name)  ($n assertions)"
  }
}
Write-Output '----'
Write-Output "assertions passed: $pass   failing files: $failed"
if ($failed -ne 0) { exit 1 }

# XZM-TEAM - version control (git) for this project folder.
#
# First run : creates the git repository and saves the first snapshot.
# Later runs: saves a new snapshot of everything that changed (a "save point").
# Optional  : copies the repository to a PRIVATE GitHub repo (asks first).
#
#   Double-click  save-to-git.bat   (in the project folder)
#   or: powershell -ExecutionPolicy Bypass -File scripts\setup-git.ps1 [-Message "what changed"]
param([string]$Message = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Set-Location $root

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }
# (named RunGit: PowerShell names are not case-sensitive, so a function called Git would hide git.exe)
function RunGit([string[]]$a) { & git.exe @a; if ($LASTEXITCODE -ne 0) { throw "git $($a -join ' ') failed" } }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Say 'Git is not installed on this computer.' Red
  Say 'Install it once, then run this again:' Yellow
  Say '  winget install --id Git.Git -e        (or download from https://git-scm.com/download/win)'
  Read-Host 'Press Enter to exit'; exit 1
}

$first = -not (Test-Path (Join-Path $root '.git'))
if ($first) {
  Say 'Creating the git repository...' Cyan
  RunGit @('init', '-b', 'main')
}

# Who is saving (stored for this project only).
$name = (& git.exe config user.name); $mail = (& git.exe config user.email)
if (-not $name) { $name = Read-Host 'Your name (shown on each save)'; RunGit @('config', 'user.name', $name) }
if (-not $mail) { $mail = Read-Host 'Your email (shown on each save)'; RunGit @('config', 'user.email', $mail) }

RunGit @('add', '-A')

# Safety: never store secrets in the repository.
$staged = @(& git.exe diff --cached --name-only)
$blocked = $staged | Where-Object { $_ -match '(^|/)\.env(\.|$)' -and $_ -notmatch '\.env\.example$' }
foreach ($f in $blocked) { RunGit @('rm', '--cached', '--quiet', '--', $f); Say "Not saved (secret file): $f" Yellow }
$leaks = @()
foreach ($f in ($staged | Where-Object { $_ -notin $blocked -and $_ -match '\.(ts|tsx|js|json|sql|md|ps1|sh|toml|ya?ml|env\.example)$' })) {
  $text = & git.exe show ":$f" | Out-String
  if ($text -match 'sb_secret_[A-Za-z0-9_-]{10,}' -or $text -match 'SERVICE_ROLE_KEY\s*=\s*\S{20,}' -or $text -match 'eyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}') { $leaks += $f }
}
if ($leaks.Count) {
  if ($first) { RunGit @('rm', '-r', '--cached', '--quiet', '.') } else { RunGit @('reset', '--quiet') }
  Say 'Stopped: these files look like they contain a secret key. Remove the key, then run again:' Red
  $leaks | ForEach-Object { Say "  $_" Red }
  Read-Host 'Press Enter to exit'; exit 2
}

& git.exe diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Say 'Nothing changed since the last save.' Green
} else {
  if (-not $Message) {
    $Message = if ($first) { 'XZM-TEAM ERP: first snapshot' } else { Read-Host 'What changed? (Enter = date only)' }
    if (-not $Message) { $Message = 'Snapshot ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
  }
  $msgFile = Join-Path $env:TEMP 'xzm-git-message.txt'
  $body = "$Message`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`nClaude-Session: https://claude.ai/code/session_01YLFL61m8YwSZFa6TPJDXSw`n"
  [IO.File]::WriteAllText($msgFile, $body, (New-Object Text.UTF8Encoding $false))
  RunGit @('commit', '--quiet', '-F', $msgFile)
  Remove-Item $msgFile -ErrorAction SilentlyContinue
  Say "Saved: $((& git.exe log -1 --format='%h  %s'))" Green
  Say "Files in this save: $((& git.exe show --name-only --format='' HEAD | Measure-Object -Line).Lines)"
}

# Optional copy on GitHub (private).
$remote = (& git.exe remote)
if ($remote) {
  if ((Read-Host 'Send this save to GitHub too? (y/N)') -match '^[yY]') { RunGit @('push', '-u', 'origin', 'main'); Say 'Sent to GitHub.' Green }
} elseif (Get-Command gh -ErrorAction SilentlyContinue) {
  if ((Read-Host 'Also keep a PRIVATE copy on GitHub? (y/N)') -match '^[yY]') {
    cmd /c "gh auth status >nul 2>&1"; if ($LASTEXITCODE -ne 0) { & gh auth login }
    & gh repo create xzm-team-erp --private --source . --push
    if ($LASTEXITCODE -eq 0) { Say 'Private GitHub repository created and uploaded.' Green }
  }
} else {
  Say 'Tip: install GitHub CLI (winget install --id GitHub.cli) to keep a private copy online.' DarkGray
}

Say ''
Say 'History of saves:' Cyan
& git.exe log --oneline -n 10
Read-Host 'Press Enter to close'

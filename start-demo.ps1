# XZM-TEAM — local demo server (no installs needed; uses Windows PowerShell only)
# Serves this project folder at http://localhost:8080/ and opens the demo.
# Stop it with Ctrl+C or by closing the window.
param([int]$Port = 8080, [string]$Open = 'demo/', [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = $Port
$prefix = "http://localhost:$port/"

$types = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.js'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.ico'='image/x-icon';
  '.md'='text/plain; charset=utf-8'; '.sql'='text/plain; charset=utf-8'; '.txt'='text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
  Write-Host "Port $port is busy. Close the other program using it, or edit `$port in this file." -ForegroundColor Red
  Read-Host 'Press Enter to exit'; exit 1
}

Write-Host ''
Write-Host '  XZM-TEAM demo is running' -ForegroundColor Green
Write-Host "  Open: ${prefix}${Open}" -ForegroundColor Green
Write-Host '  Press Ctrl+C or close this window to stop.'
Write-Host ''
if (-not $NoOpen) { Start-Process "${prefix}${Open}" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($rel -eq '') { $rel = 'demo/' }
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      # never serve anything outside the project folder
      if (-not $path.StartsWith([IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403; $res.Close(); continue
      }
      if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
      if (Test-Path $path -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($path)
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
        $res.Headers.Add('Cache-Control', 'no-store')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host ("200  /" + $rel)
      } else {
        $res.StatusCode = 404
        $msg = [Text.Encoding]::UTF8.GetBytes('Not found')
        $res.OutputStream.Write($msg, 0, $msg.Length)
        Write-Host ("404  /" + $rel) -ForegroundColor Yellow
      }
    } catch { $res.StatusCode = 500 } finally { $res.Close() }
  }
} finally { $listener.Stop() }

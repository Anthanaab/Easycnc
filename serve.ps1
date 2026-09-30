# Petit serveur local (http://localhost:8080) pour développer / tester sous Windows.
# Sert les fichiers statiques et imite l'API de stockage (voir server/easycnc_api.py) dans le dossier .devdata.
param([int]$Port = 8080)
$root = $PSScriptRoot
$data = Join-Path $root '.devdata'
foreach ($d in 'store', 'projects') { New-Item -ItemType Directory -Force -Path (Join-Path $data $d) | Out-Null }
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.py'='text/plain; charset=utf-8' }
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Send($c, $code, $ctype, [byte[]]$bytes) {
  $c.Response.StatusCode = $code
  $c.Response.ContentType = $ctype
  $c.Response.Headers.Add('Cache-Control', 'no-store')
  $c.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}
function SendJson($c, $code, $obj) {
  Send $c $code 'application/json; charset=utf-8' ($utf8.GetBytes(($obj | ConvertTo-Json -Depth 20 -Compress)))
}

function Api($c, $path) {
  $method = $c.Request.HttpMethod
  $body = ''
  if ($c.Request.HasEntityBody) { $body = (New-Object System.IO.StreamReader($c.Request.InputStream, $utf8)).ReadToEnd() }
  $parts = $path.Trim('/').Split('/')
  if ($parts.Count -gt 3) { return SendJson $c 404 @{ error = 'introuvable' } }
  $area = $parts[1]; $id = if ($parts.Count -gt 2) { $parts[2] } else { $null }
  if ($area -eq 'ping') { return SendJson $c 200 @{ ok = $true; service = 'easycnc-dev' } }
  if ($area -eq 'store') {
    $dir = Join-Path $data 'store'
    if (-not $id) {
      $out = [ordered]@{}
      Get-ChildItem $dir -Filter *.json | ForEach-Object { $out[$_.BaseName] = [IO.File]::ReadAllText($_.FullName, $utf8) }
      return SendJson $c 200 $out
    }
    if ($id -notmatch '^easycnc\.[A-Za-z0-9._-]{1,120}$') { return SendJson $c 400 @{ error = 'clé invalide' } }
    $f = Join-Path $dir ($id + '.json')
    if ($method -eq 'PUT') { [IO.File]::WriteAllText($f, $body, $utf8); return SendJson $c 200 @{ ok = $true } }
    if ($method -eq 'DELETE') { Remove-Item $f -ErrorAction SilentlyContinue; return SendJson $c 200 @{ ok = $true } }
    return SendJson $c 405 @{ error = 'méthode' }
  }
  if ($area -eq 'projects') {
    $dir = Join-Path $data 'projects'
    if (-not $id) {
      $list = @(Get-ChildItem $dir -Filter *.json | Sort-Object LastWriteTimeUtc -Descending | ForEach-Object {
        $p = [IO.File]::ReadAllText($_.FullName, $utf8) | ConvertFrom-Json
        @{ id = $_.BaseName; name = $(if ($p.name) { $p.name } else { 'Sans titre' }); updated = $_.LastWriteTimeUtc.ToString('o');
           w = $p.stock.w; h = $p.stock.h; t = $p.stock.t; shapes = @($p.shapes).Count; mode = $(if ($p.mode) { $p.mode } else { 'mill' }) }
      })
      return Send $c 200 'application/json; charset=utf-8' ($utf8.GetBytes('[' + (($list | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'))
    }
    if ($id -notmatch '^[a-z0-9]{6,32}$') { return SendJson $c 400 @{ error = 'identifiant invalide' } }
    $f = Join-Path $dir ($id + '.json')
    if ($method -eq 'GET') {
      if (-not (Test-Path $f)) { return SendJson $c 404 @{ error = 'projet introuvable' } }
      return Send $c 200 'application/json; charset=utf-8' ($utf8.GetBytes([IO.File]::ReadAllText($f, $utf8)))
    }
    if ($method -eq 'PUT') {
      try { $null = $body | ConvertFrom-Json } catch { return SendJson $c 400 @{ error = 'JSON invalide' } }
      [IO.File]::WriteAllText($f, $body, $utf8); return SendJson $c 200 @{ ok = $true; id = $id }
    }
    if ($method -eq 'DELETE') { Remove-Item $f -ErrorAction SilentlyContinue; return SendJson $c 200 @{ ok = $true } }
    return SendJson $c 405 @{ error = 'méthode' }
  }
  return SendJson $c 404 @{ error = 'introuvable' }
}

$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "EasyCNC : http://localhost:$Port/  (API de développement : .devdata)"
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath)
    if ($p.StartsWith('/api/')) { Api $c $p }
    else {
      if ($p -eq '/') { $p = '/index.html' }
      $f = Join-Path $root ($p.TrimStart('/') -replace '/', '\')
      if ((Test-Path $f -PathType Leaf) -and $f.StartsWith($root) -and -not $f.StartsWith($data)) {
        $ext = [IO.Path]::GetExtension($f).ToLower()
        Send $c 200 $(if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }) ([IO.File]::ReadAllBytes($f))
      } else { $c.Response.StatusCode = 404 }
    }
  } catch { try { $c.Response.StatusCode = 500 } catch {} }
  $c.Response.Close()
}

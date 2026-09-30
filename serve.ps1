# Petit serveur statique local (http://localhost:8080) - optionnel : index.html fonctionne aussi en double-clic.
param([int]$Port = 8080)
$root = $PSScriptRoot
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.svg'='image/svg+xml'; '.png'='image/png' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "EasyCNC : http://localhost:$Port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath)
  if ($p -eq '/') { $p = '/index.html' }
  $f = Join-Path $root ($p.TrimStart('/') -replace '/', '\')
  if ((Test-Path $f -PathType Leaf) -and $f.StartsWith($root)) {
    $b = [IO.File]::ReadAllBytes($f)
    $ext = [IO.Path]::GetExtension($f).ToLower()
    $c.Response.ContentType = $(if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' })
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}

$out = @()
$base = "https://species-canned-economist.ngrok-free.dev"

# 1) Login a traves del tunel AHORA
$body = @{ username="123456789"; password="123456789" } | ConvertTo-Json
$out += "=== 1) LOGIN via tunel ==="
try {
  $r = Invoke-WebRequest -Uri "$base/api/auth/login" -Method Post -Body $body -ContentType "application/json" -Headers @{"ngrok-skip-browser-warning"="true"} -TimeoutSec 25 -UseBasicParsing
  $out += "status=$($r.StatusCode)  -> LOGIN OK via tunel"
} catch {
  $out += "ERR status=$($_.Exception.Response.StatusCode.value__): $($_.Exception.Message)"
  if ($_.ErrorDetails) { $out += "BODY: " + $_.ErrorDetails.Message }
}

# 2) Verificar que el APK del Escritorio tenga la URL de ngrok embebida
$out += ""
$out += "=== 2) URL embebida en el APK ==="
$apk = Join-Path ([Environment]::GetFolderPath('Desktop')) "cicanet_mobile.apk"
if (Test-Path $apk) {
  $tmp = Join-Path $env:TEMP "apk_inspect"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  $zip = Join-Path $env:TEMP "apk_inspect.zip"
  Copy-Item $apk $zip -Force
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $libs = Get-ChildItem -Path $tmp -Recurse -Filter "libapp.so" -ErrorAction SilentlyContinue
  $found = $false
  foreach ($l in $libs) {
    $bytes = [System.IO.File]::ReadAllBytes($l.FullName)
    $text = [System.Text.Encoding]::ASCII.GetString($bytes)
    if ($text -match "species-canned-economist\.ngrok-free\.dev") { $found = $true; $out += "ENCONTRADO 'species-canned-economist.ngrok-free.dev' en $($l.Name)" }
    elseif ($text -match "localhost:4000") { $out += "OJO: el APK contiene 'localhost:4000' en $($l.Name)" }
  }
  if (-not $found) { $out += "NO se encontro la URL de ngrok en libapp.so (posible que el dart-define no quedo)." }
  Remove-Item $zip,$tmp -Recurse -Force -ErrorAction SilentlyContinue
} else {
  $out += "No existe el APK en el Escritorio."
}

$out | Out-File -Encoding utf8 $env:TEMP\cica_diag.txt
Get-Content $env:TEMP\cica_diag.txt

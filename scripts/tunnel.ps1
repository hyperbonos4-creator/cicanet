# ============================================================
#  CICANET · Túnel público con ngrok (exponer el software por web)
#
#  Uso (PowerShell, desde la raíz del repo o cualquier carpeta):
#     ./scripts/tunnel.ps1                # usa el token guardado y abre el túnel
#     ./scripts/tunnel.ps1 -Up            # además levanta el stack docker
#     ./scripts/tunnel.ps1 -AuthToken xxx # guarda y usa otro token
#     ./scripts/tunnel.ps1 -Port 3080     # puerto local del WEB (default 3080)
#
#  Qué hace:
#   1. Guarda el authtoken de ngrok (persistente en tu equipo) la primera vez.
#   2. (Opcional con -Up) levanta el stack docker y espera a que el web responda.
#   3. Abre un túnel HTTPS hacia el WEB (puerto 3080 → contenedor Next:3000).
#      El web ya reenvía /api y /socket.io al backend (mismo origen), así que
#      UN solo túnel expone TODO sin necesidad de tocar localhost:4000.
#   4. Imprime la URL pública para abrir el panel desde el móvil/cualquier lugar.
#
#  Seguridad: el token se lee de (en orden) -AuthToken, $env:NGROK_AUTHTOKEN,
#  o el archivo local scripts/.ngrok-authtoken (NO versionado). Nunca se imprime.
# ============================================================
[CmdletBinding()]
param(
  [string]$AuthToken = "",
  [int]$Port = 3080,
  [switch]$Up
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($m) { Write-Host "▶ $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "✔ $m" -ForegroundColor Green }
function Write-WarnMsg($m) { Write-Host "⚠ $m" -ForegroundColor Yellow }

# --- 1) Localizar ngrok -------------------------------------------------------
$ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
if (-not $ngrok) {
  foreach ($p in @(
      "$env:LOCALAPPDATA\ngrok\ngrok.exe",
      "$env:USERPROFILE\ngrok.exe",
      "$env:USERPROFILE\Downloads\ngrok.exe",
      "C:\ngrok\ngrok.exe")) {
    if (Test-Path $p) { $ngrok = $p; break }
  }
}
if (-not $ngrok) {
  Write-WarnMsg "No se encontró ngrok. Instálalo con uno de estos comandos y vuelve a ejecutar:"
  Write-Host "    winget install ngrok.ngrok"
  Write-Host "    choco install ngrok"
  Write-Host "  o descárgalo de https://ngrok.com/download y agrégalo al PATH."
  exit 1
}
Write-Ok "ngrok encontrado: $ngrok"

# --- 2) Resolver y guardar el authtoken --------------------------------------
$tokenFile = Join-Path $PSScriptRoot ".ngrok-authtoken"
$token = $AuthToken
if (-not $token -and $env:NGROK_AUTHTOKEN) { $token = $env:NGROK_AUTHTOKEN }
if (-not $token -and (Test-Path $tokenFile)) {
  $token = (Get-Content $tokenFile | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1).Trim()
}
if ($token) {
  Write-Step "Guardando el authtoken de ngrok (persistente en tu equipo)…"
  & $ngrok config add-authtoken $token | Out-Null
  # Lo dejamos cacheado localmente para próximas ejecuciones (archivo gitignored).
  if (-not (Test-Path $tokenFile)) { Set-Content -Path $tokenFile -Value $token -Encoding ascii }
  Write-Ok "Authtoken configurado."
} else {
  Write-WarnMsg "Sin authtoken explícito; se usará el que ya tenga ngrok configurado."
}

# --- 3) (Opcional) levantar el stack docker ----------------------------------
if ($Up) {
  Write-Step "Levantando el stack docker (docker compose up -d --build)…"
  Push-Location $repoRoot
  try { docker compose up -d --build } finally { Pop-Location }
}

# Espera breve a que el web responda en el puerto local.
Write-Step "Verificando que el WEB responda en http://localhost:$Port …"
$webOk = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -ge 200) { $webOk = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if ($webOk) { Write-Ok "El web responde." }
else { Write-WarnMsg "El web no respondió aún en :$Port. Si no está arriba, ejecuta:  docker compose up -d  (o usa -Up)." }

# --- 4) Abrir el túnel --------------------------------------------------------
Write-Step "Abriendo túnel ngrok hacia el web (puerto $Port)…"
# --host-header=rewrite: el backend (Next rewrite) recibe el Host correcto.
$args = @("http", "$Port", "--host-header=rewrite", "--log=stdout")
$proc = Start-Process -FilePath $ngrok -ArgumentList $args -PassThru -WindowStyle Hidden

# Recuperar la URL pública desde la API local de ngrok (puerto 4040).
$publicUrl = $null
for ($i = 0; $i -lt 20; $i++) {
  try {
    $t = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
    $https = $t.tunnels | Where-Object { $_.public_url -like "https*" } | Select-Object -First 1
    if ($https) { $publicUrl = $https.public_url; break }
  } catch { }
  Start-Sleep -Seconds 1
}

Write-Host ""
if ($publicUrl) {
  Write-Host "============================================================" -ForegroundColor Green
  Write-Host "  CICANET expuesto en:  $publicUrl" -ForegroundColor Green
  Write-Host "  Panel admin:          $publicUrl/login" -ForegroundColor Green
  Write-Host "  Inspector ngrok:      http://127.0.0.1:4040" -ForegroundColor DarkGray
  Write-Host "============================================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "WhatsApp: entra a Soporte y escanea el QR (se refresca solo) o usa" -ForegroundColor Yellow
  Write-Host "'Vincular por código' si no puedes escanear desde el móvil." -ForegroundColor Yellow
} else {
  Write-WarnMsg "No pude leer la URL pública de ngrok (revisa http://127.0.0.1:4040)."
}
Write-Host ""
Write-Host "El túnel está activo. Cierra esta ventana o presiona Ctrl+C para detenerlo." -ForegroundColor DarkGray

# Mantener vivo el túnel y limpiar al salir.
try {
  Wait-Process -Id $proc.Id
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Write-Host "Túnel detenido." -ForegroundColor DarkGray
}

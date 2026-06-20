# ============================================================
#  CICANET - Tunel publico con ngrok (exponer el software por web)
#
#  Uso (PowerShell), desde la RAIZ del repo:
#     .\scripts\tunnel.ps1            # usa el token guardado y abre el tunel
#     .\scripts\tunnel.ps1 -Up        # ademas levanta el stack docker
#     .\scripts\tunnel.ps1 -AuthToken xxx   # guarda y usa otro token
#     .\scripts\tunnel.ps1 -Port 3080       # puerto local del WEB (default 3080)
#
#  Si estas DENTRO de la carpeta scripts, ejecuta:  .\tunnel.ps1
#
#  Que hace:
#   1. Guarda el authtoken de ngrok (persistente en tu equipo) la primera vez.
#   2. (Opcional con -Up) levanta el stack docker y espera a que el web responda.
#   3. Abre un tunel HTTPS hacia el WEB (puerto 3080 -> contenedor Next:3000).
#      El web ya reenvia /api y /socket.io al backend (mismo origen), asi que
#      UN solo tunel expone TODO sin tocar localhost:4000.
#   4. Imprime la URL publica para abrir el panel desde el movil/cualquier lugar.
#
#  Seguridad: el token se lee de (en orden) -AuthToken, $env:NGROK_AUTHTOKEN,
#  o el archivo local scripts\.ngrok-authtoken (NO versionado). Nunca se imprime.
# ============================================================
[CmdletBinding()]
param(
  [string]$AuthToken = "",
  [int]$Port = 3080,
  [switch]$Up
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($m) { Write-Host ">> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Write-WarnMsg($m) { Write-Host "[!] $m" -ForegroundColor Yellow }

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
  Write-WarnMsg "No se encontro ngrok. Instalalo con uno de estos comandos y vuelve a ejecutar:"
  Write-Host "    winget install ngrok.ngrok"
  Write-Host "    choco install ngrok"
  Write-Host "  o descargalo de https://ngrok.com/download y agregalo al PATH."
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
  Write-Step "Guardando el authtoken de ngrok (persistente en tu equipo)..."
  & $ngrok config add-authtoken $token | Out-Null
  if (-not (Test-Path $tokenFile)) { Set-Content -Path $tokenFile -Value $token -Encoding ascii }
  Write-Ok "Authtoken configurado."
} else {
  Write-WarnMsg "Sin authtoken explicito; se usara el que ya tenga ngrok configurado."
}

# --- 3) (Opcional) levantar el stack docker ----------------------------------
if ($Up) {
  Write-Step "Levantando el stack docker (docker compose up -d --build)..."
  Push-Location $repoRoot
  try { docker compose up -d --build } finally { Pop-Location }
}

# Espera breve a que el web responda en el puerto local.
Write-Step "Verificando que el WEB responda en http://localhost:$Port ..."
$webOk = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -ge 200) { $webOk = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if ($webOk) { Write-Ok "El web responde." }
else { Write-WarnMsg "El web no respondio aun en :$Port. Si no esta arriba, ejecuta: docker compose up -d (o usa -Up)." }

# --- 4) Abrir el tunel --------------------------------------------------------
Write-Step "Abriendo tunel ngrok hacia el web (puerto $Port)..."
$ngrokArgs = @("http", "$Port", "--host-header=rewrite", "--log=stdout")
$proc = Start-Process -FilePath $ngrok -ArgumentList $ngrokArgs -PassThru -WindowStyle Hidden

# Recuperar la URL publica desde la API local de ngrok (puerto 4040).
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
  Write-Host "'Vincular por codigo' si no puedes escanear desde el movil." -ForegroundColor Yellow
} else {
  Write-WarnMsg "No pude leer la URL publica de ngrok (revisa http://127.0.0.1:4040)."
}
Write-Host ""
Write-Host "El tunel esta activo. Cierra esta ventana o presiona Ctrl+C para detenerlo." -ForegroundColor DarkGray

# Mantener vivo el tunel y limpiar al salir.
try {
  Wait-Process -Id $proc.Id
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Write-Host "Tunel detenido." -ForegroundColor DarkGray
}

<#
  CICANET — Compila la app movil (Android .apk + iOS .ipa) en la nube y baja
  AMBOS al Escritorio. Pensado para ejecutarse MANUALMENTE en Windows.

  Que hace, de principio a fin:
    1) Sube tus cambios (git add + commit + push) al repo de GitHub.
    2) Eso dispara el workflow "Mobile Build (APK + IPA)" en la nube de GitHub
       (Linux compila el .apk, un Mac compila el .ipa, en paralelo y gratis).
    3) Muestra el avance en vivo de los dos builds hasta que terminan.
    4) Descarga el .apk y el .ipa y los deja en tu Escritorio.

  Por que la nube: el .ipa SOLO se puede compilar en macOS (regla de Apple).
  Desde Windows no hay forma local; por eso se compila en un Mac de GitHub.

  Requisitos:
    - git configurado con el remoto 'origin' en GitHub (ya lo tienes).
    - Un token de GitHub (PAT) con permisos: Contents (push) y Actions (leer
      ejecuciones y descargar artefactos). Pasalo con -Token, o ponlo en la
      variable de entorno GH_TOKEN, o el script te lo pedira.

  Uso:
    # API por defecto (localhost — para emulador):
    .\build-mobile.ps1

    # Apuntando la app a tu backend publico (para celular/iPhone reales):
    .\build-mobile.ps1 -ApiUrl "https://TU-URL-PUBLICA/api"

    # Sin hacer commit (solo push de lo ya commiteado + build):
    .\build-mobile.ps1 -NoCommit
#>

[CmdletBinding()]
param(
  [string]$ApiUrl = "",
  [string]$Token = "",
  [string]$CommitMessage = "",
  [switch]$NoCommit
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Info($msg)     { Write-Host "    $msg" -ForegroundColor Gray }
function Die($msg)      { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

# Raiz del repo (este script vive en apps/mobile/scripts).
$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { Die "No estas dentro de un repo git." }
Set-Location $repoRoot
$desktop = [Environment]::GetFolderPath("Desktop")

Write-Host "===============================================" -ForegroundColor White
Write-Host " CICANET · Build movil en la nube (APK + IPA)" -ForegroundColor White
Write-Host "===============================================" -ForegroundColor White

# --- 0) Token -----------------------------------------------------------------
if (-not $Token) { $Token = $env:GH_TOKEN }
if (-not $Token) { $Token = $env:GITHUB_TOKEN }
if (-not $Token) {
  Write-Host ""
  $sec = Read-Host "Pega tu token de GitHub (PAT con permisos Contents + Actions)" -AsSecureString
  $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not $Token) { Die "Se necesita un token de GitHub." }

# --- Resolver owner/repo desde origin -----------------------------------------
$originUrl = (git remote get-url origin 2>$null)
if (-not $originUrl) { Die "No hay remoto 'origin'. Configura GitHub primero." }
if ($originUrl -notmatch 'github\.com[:/]+([^/]+)/([^/.]+)') { Die "No pude leer owner/repo de: $originUrl" }
$owner = $Matches[1]; $repo = $Matches[2]
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$apiRoot = "https://api.github.com/repos/$owner/$repo"
$ghHeaders = @{
  Authorization          = "Bearer $Token"
  "User-Agent"           = "cicanet-build"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}
Info "Repo:   $owner/$repo"
Info "Rama:   $branch"
if ($ApiUrl) { Info "API:    $ApiUrl" } else { Info "API:    (localhost por defecto)" }

# --- 1) Escribir disparador + commit + push -----------------------------------
Step 1 "Subiendo cambios a GitHub (esto dispara el build)..."
$triggerPath = Join-Path $repoRoot "apps/mobile/.build-trigger"
$ts = (Get-Date).ToString("o")
$triggerLines = @("ts=$ts")
if ($ApiUrl) { $triggerLines += "api_base_url=$ApiUrl" }
Set-Content -Path $triggerPath -Value $triggerLines -Encoding ascii
Info "Disparador escrito: apps/mobile/.build-trigger"

if (-not $NoCommit) {
  git add -A | Out-Null
  if (-not $CommitMessage) { $CommitMessage = "build(mobile): compilar APK + IPA ($ts)" }
  # commit puede 'fallar' si no hay nada que commitear; no es error.
  git commit -m $CommitMessage 2>&1 | Out-Null
} else {
  # Aun en -NoCommit, el disparador debe viajar para forzar el build.
  git add -- "apps/mobile/.build-trigger" | Out-Null
  git commit -m "build(mobile): disparar build ($ts)" 2>&1 | Out-Null
}

$pushOut = (git push origin HEAD 2>&1)
if ($LASTEXITCODE -ne 0) { Write-Host $pushOut; Die "Fallo el 'git push'. Revisa credenciales/remoto." }
$headSha = (git rev-parse HEAD).Trim()
Ok "Push hecho. Commit $($headSha.Substring(0,7)) en $branch."

# --- 2) Localizar la ejecucion disparada --------------------------------------
Step 2 "Localizando la ejecucion en GitHub Actions..."
$runId = $null
for ($i = 0; $i -lt 24 -and -not $runId; $i++) {
  Start-Sleep -Seconds 5
  try {
    $runs = Invoke-RestMethod -Headers $ghHeaders -Uri "$apiRoot/actions/workflows/mobile-build.yml/runs?branch=$branch&per_page=10"
  } catch {
    Die "No pude consultar Actions (HTTP). El token quiza no tiene permiso 'Actions: read'. Detalle: $($_.Exception.Message)"
  }
  $match = $runs.workflow_runs | Where-Object { $_.head_sha -eq $headSha } | Select-Object -First 1
  if ($match) { $runId = $match.id }
  else { Info "Esperando a que GitHub registre la ejecucion... ($($i+1))" }
}
if (-not $runId) {
  Die "No aparecio una ejecucion para el commit $($headSha.Substring(0,7)). Abre: https://github.com/$owner/$repo/actions"
}
$runUrl = "https://github.com/$owner/$repo/actions/runs/$runId"
Ok "Ejecucion #$runId iniciada."
Info $runUrl

# --- 3) Seguir el avance en vivo ----------------------------------------------
Step 3 "Compilando en la nube (APK en Linux, IPA en Mac). Suele tardar 10-20 min..."
$lastLine = ""
while ($true) {
  Start-Sleep -Seconds 15
  try {
    $run  = Invoke-RestMethod -Headers $ghHeaders -Uri "$apiRoot/actions/runs/$runId"
    $jobs = Invoke-RestMethod -Headers $ghHeaders -Uri "$apiRoot/actions/runs/$runId/jobs"
  } catch {
    Info "Reintentando lectura de estado..."; continue
  }
  $parts = foreach ($j in $jobs.jobs) {
    $state = if ($j.status -eq "completed") { $j.conclusion } else { $j.status }
    $shortName = ($j.name -split '\(')[0].Trim()
    "$shortName = $state"
  }
  $line = ("    " + ($parts -join "  |  "))
  if ($line -ne $lastLine) { Write-Host $line -ForegroundColor Yellow; $lastLine = $line }

  if ($run.status -eq "completed") {
    if ($run.conclusion -ne "success") {
      Write-Host ""
      Die "El build termino en estado '$($run.conclusion)'. Revisa el detalle en: $runUrl"
    }
    Ok "Build completado con exito."
    break
  }
}

# --- 4) Descargar artefactos al Escritorio ------------------------------------
Step 4 "Descargando .apk y .ipa al Escritorio..."

function Download-Artifact($archiveUrl, $outZip) {
  # GitHub responde 302 a una URL firmada (sin auth). Two-step para no romper.
  $req = [System.Net.HttpWebRequest]::Create($archiveUrl)
  $req.Method = "GET"
  $req.Headers["Authorization"] = "Bearer $Token"
  $req.UserAgent = "cicanet-build"
  $req.Accept = "application/vnd.github+json"
  $req.AllowAutoRedirect = $false
  try { $resp = $req.GetResponse() } catch { if ($_.Exception.Response) { $resp = $_.Exception.Response } else { throw } }
  $loc = $resp.Headers["Location"]
  $resp.Close()
  if (-not $loc) { throw "GitHub no devolvio el enlace de descarga del artefacto." }
  Invoke-WebRequest -Uri $loc -OutFile $outZip -UseBasicParsing
}

$arts = Invoke-RestMethod -Headers $ghHeaders -Uri "$apiRoot/actions/runs/$runId/artifacts"
$tmp = Join-Path $env:TEMP ("cicanet-mobile-" + $runId)
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$results = @()

$map = @{ "cicanet-apk" = "cicanet_mobile.apk"; "cicanet-ipa" = "cicanet_mobile.ipa" }
foreach ($name in $map.Keys) {
  $a = $arts.artifacts | Where-Object { $_.name -eq $name -and -not $_.expired } | Select-Object -First 1
  if (-not $a) { Info "Artefacto '$name' no encontrado (puede que ese job no haya producido salida)."; continue }
  $zip = Join-Path $tmp "$name.zip"
  Info "Bajando $name ..."
  Download-Artifact $a.archive_download_url $zip
  $unzip = Join-Path $tmp $name
  if (Test-Path $unzip) { Remove-Item $unzip -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $unzip -Force
  $file = Get-ChildItem -Path $unzip -Recurse -File | Select-Object -First 1
  if ($file) {
    $final = Join-Path $desktop $map[$name]
    Copy-Item $file.FullName $final -Force
    $results += $final
    Ok "Guardado: $final"
  }
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- Resumen ------------------------------------------------------------------
Write-Host "`n===============================================" -ForegroundColor White
Write-Host " LISTO" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor White
foreach ($r in $results) { Write-Host "  $r" -ForegroundColor Green }
Write-Host ""
Write-Host " Android (.apk): instalalo directo en el celular (activa 'origenes desconocidos')." -ForegroundColor Gray
Write-Host " iOS (.ipa, sin firma): instalalo con Sideloadly (https://sideloadly.io) + Apple ID" -ForegroundColor Gray
Write-Host "   gratuito. Luego: Ajustes > General > VPN y gestion de dispositivos > confiar." -ForegroundColor Gray
Write-Host "   La firma gratuita caduca a los 7 dias (se re-sideloadea)." -ForegroundColor Gray
if (-not $ApiUrl) {
  Write-Host ""
  Write-Host " NOTA: compilaste con API=localhost. En un celular/iPhone REAL eso no apunta a tu PC." -ForegroundColor DarkYellow
  Write-Host '   Vuelve a correr con:  .\build-mobile.ps1 -ApiUrl "https://TU-URL-PUBLICA/api"' -ForegroundColor DarkYellow
}

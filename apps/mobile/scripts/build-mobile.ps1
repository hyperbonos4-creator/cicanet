<#
  CICANET - Compila la app movil (Android .apk + iOS .ipa) en la nube y baja
  AMBOS al Escritorio. Se ejecuta UNA vez y hace TODO el proceso solo:
  push -> dispara el build -> monitoreo en vivo -> descarga al Escritorio.

  Por que la nube: el .ipa SOLO se puede compilar en macOS (regla de Apple).
  Desde Windows no hay forma local; por eso se compila en un Mac de GitHub
  (gratis). El .apk se compila en paralelo en un Linux de GitHub.

  Requisitos:
    - git con el remoto 'origin' en GitHub (ya lo tienes).
    - Un token de GitHub (PAT) con permisos Contents (push) y Actions (leer
      ejecuciones + descargar artefactos). Se pasa con -Token, por la variable
      de entorno GH_TOKEN, o el script lo pide al arrancar.

  Uso (desde cualquier carpeta dentro del repo):
    .\build-mobile.ps1                                   # API por defecto (localhost)
    .\build-mobile.ps1 -ApiUrl "https://TU-URL/api"      # para celular/iPhone reales
    .\build-mobile.ps1 -NoCommit                         # no commitear; solo push+build
#>

[CmdletBinding()]
param(
  [string]$ApiUrl = "",
  [string]$Token = "",
  [string]$CommitMessage = "",
  [switch]$NoCommit
)

# OJO: NO usamos ErrorActionPreference='Stop' global, porque git escribe su
# progreso normal en stderr y eso, con 'Stop', aborta el script en pleno push.
# Manejamos los errores explicitamente (Die) y los exit codes de git.
$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Info($msg)     { Write-Host "    $msg" -ForegroundColor Gray }
function Warn($msg)     { Write-Host "    ! $msg" -ForegroundColor DarkYellow }
function Die($msg)      { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

# Ejecuta git sin que su salida por stderr mate el script. Devuelve Output+Code.
function Git-Run {
  param([Parameter(Mandatory=$true)][string[]]$GitArgs, [switch]$AllowFail)
  $output = (& git @GitArgs 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFail) {
    Die ("git " + ($GitArgs -join ' ') + " fallo (exit $code):`n$output")
  }
  return [pscustomobject]@{ Output = $output.Trim(); Code = $code }
}

# Llamada REST a GitHub con manejo de error legible.
function Gh-Api($url) {
  try {
    return Invoke-RestMethod -Headers $script:ghHeaders -Uri $url
  } catch {
    $msg = $_.Exception.Message
    if ($_.ErrorDetails) { $msg += " | " + $_.ErrorDetails.Message }
    throw "GitHub API fallo ($url): $msg"
  }
}

Write-Host "===============================================" -ForegroundColor White
Write-Host " CICANET - Build movil en la nube (APK + IPA)"   -ForegroundColor White
Write-Host "===============================================" -ForegroundColor White

# --- Ubicarse en la raiz del repo --------------------------------------------
$repoRoot = (Git-Run @('rev-parse','--show-toplevel')).Output
if (-not $repoRoot) { Die "No estas dentro de un repo git." }
Set-Location $repoRoot
$desktop = [Environment]::GetFolderPath("Desktop")

# --- Token --------------------------------------------------------------------
if (-not $Token) { $Token = $env:GH_TOKEN }
if (-not $Token) { $Token = $env:GITHUB_TOKEN }
if (-not $Token) {
  Write-Host ""
  $sec = Read-Host "Pega tu token de GitHub (PAT con permisos Contents + Actions)" -AsSecureString
  $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not $Token) { Die "Se necesita un token de GitHub." }

# --- owner/repo desde origin --------------------------------------------------
$originUrl = (Git-Run @('remote','get-url','origin')).Output
if ($originUrl -notmatch 'github\.com[:/]+([^/]+)/([^/.]+)') { Die "No pude leer owner/repo de: $originUrl" }
$owner = $Matches[1]; $repo = $Matches[2]
$branch = (Git-Run @('rev-parse','--abbrev-ref','HEAD')).Output
$apiRoot = "https://api.github.com/repos/$owner/$repo"
$script:ghHeaders = @{
  Authorization          = "Bearer $Token"
  "User-Agent"           = "cicanet-build"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}
Info "Repo:   $owner/$repo"
Info "Rama:   $branch"
if ($ApiUrl) { Info "API:    $ApiUrl" } else { Info "API:    (localhost por defecto)" }

# Aviso temprano si el push por HTTPS necesitara credenciales (mejor usar el token).
$pushUrl = "https://$Token@github.com/$owner/$repo.git"

# --- 1) Disparador + commit + push -------------------------------------------
Step 1 "Subiendo cambios a GitHub (esto dispara el build)..."
$triggerPath = Join-Path $repoRoot "apps/mobile/.build-trigger"
$ts = (Get-Date).ToString("o")
$triggerLines = @("ts=$ts")
if ($ApiUrl) { $triggerLines += "api_base_url=$ApiUrl" }
Set-Content -Path $triggerPath -Value $triggerLines -Encoding ascii
Info "Disparador escrito: apps/mobile/.build-trigger"

if ($NoCommit) {
  Git-Run @('add','--','apps/mobile/.build-trigger') | Out-Null
} else {
  Git-Run @('add','-A') | Out-Null
}
if (-not $CommitMessage) { $CommitMessage = "build(mobile): compilar APK + IPA ($ts)" }
$commit = Git-Run -GitArgs @('commit','-m',$CommitMessage) -AllowFail
if ($commit.Code -ne 0) { Info "(Nada nuevo que commitear; sigo con push.)" }

# Push usando el token en la URL (evita pedir credenciales y no depende de un
# helper de credenciales configurado). No imprime el token.
$push = Git-Run -GitArgs @('push',$pushUrl,"HEAD:$branch") -AllowFail
if ($push.Code -ne 0) { Die "Fallo el 'git push'. Verifica que el token tenga permiso de escritura (Contents)." }
$headSha = (Git-Run @('rev-parse','HEAD')).Output
Ok "Push hecho. Commit $($headSha.Substring(0,7)) en $branch."

# --- 2) Localizar la ejecucion disparada por el push --------------------------
Step 2 "Localizando la ejecucion en GitHub Actions..."
$runId = $null
for ($i = 0; $i -lt 30 -and -not $runId; $i++) {
  Start-Sleep -Seconds 5
  try {
    $runs = Gh-Api "$apiRoot/actions/workflows/mobile-build.yml/runs?branch=$branch&per_page=10"
  } catch {
    Die "$($_.Exception.Message)`nEl token quiza no tiene permiso 'Actions: read'."
  }
  $match = $runs.workflow_runs | Where-Object { $_.head_sha -eq $headSha } | Select-Object -First 1
  if ($match) { $runId = $match.id } else { Info "Esperando a que GitHub registre la ejecucion... ($($i+1))" }
}
if (-not $runId) { Die "No aparecio una ejecucion para $($headSha.Substring(0,7)). Abre: https://github.com/$owner/$repo/actions" }
$runUrl = "https://github.com/$owner/$repo/actions/runs/$runId"
Ok "Ejecucion #$runId iniciada."
Info $runUrl

# --- 3) Monitoreo en vivo -----------------------------------------------------
Step 3 "Compilando en la nube (APK en Linux, IPA en Mac). Suele tardar 10-20 min..."
$start = Get-Date
$lastLine = ""
while ($true) {
  Start-Sleep -Seconds 15
  try {
    $run  = Gh-Api "$apiRoot/actions/runs/$runId"
    $jobs = Gh-Api "$apiRoot/actions/runs/$runId/jobs"
  } catch { Info "Reintentando lectura de estado..."; continue }

  $parts = foreach ($j in $jobs.jobs) {
    $state = if ($j.status -eq "completed") { $j.conclusion } else { $j.status }
    $shortName = ($j.name -split '\(')[0].Trim()
    "$shortName = $state"
  }
  $mins = [int]((Get-Date) - $start).TotalMinutes
  $line = "    [{0,2} min]  {1}" -f $mins, ($parts -join "   |   ")
  if ($line -ne $lastLine) { Write-Host $line -ForegroundColor Yellow; $lastLine = $line }

  if ($run.status -eq "completed") {
    if ($run.conclusion -ne "success") { Die "El build termino en '$($run.conclusion)'. Detalle: $runUrl" }
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

$arts = Gh-Api "$apiRoot/actions/runs/$runId/artifacts"
$tmp = Join-Path $env:TEMP ("cicanet-mobile-" + $runId)
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$results = @()
$map = [ordered]@{ "cicanet-apk" = "cicanet_mobile.apk"; "cicanet-ipa" = "cicanet_mobile.ipa" }

foreach ($name in $map.Keys) {
  $a = $arts.artifacts | Where-Object { $_.name -eq $name -and -not $_.expired } | Select-Object -First 1
  if (-not $a) { Warn "Artefacto '$name' no encontrado."; continue }
  $zip = Join-Path $tmp "$name.zip"
  Info "Bajando $name ..."
  try {
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
    } else { Warn "El zip de '$name' vino vacio." }
  } catch { Warn "No pude bajar '$name': $($_.Exception.Message)" }
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- Resumen ------------------------------------------------------------------
Write-Host "`n===============================================" -ForegroundColor White
if ($results.Count -gt 0) { Write-Host " LISTO" -ForegroundColor Green } else { Write-Host " TERMINO, pero no se bajo ningun archivo" -ForegroundColor Red }
Write-Host "===============================================" -ForegroundColor White
foreach ($r in $results) { Write-Host "  $r" -ForegroundColor Green }
Write-Host ""
Write-Host " Android (.apk): instalalo directo en el celular (activa 'origenes desconocidos')." -ForegroundColor Gray
Write-Host " iOS (.ipa, sin firma): instalalo con Sideloadly (https://sideloadly.io) + Apple ID" -ForegroundColor Gray
Write-Host "   gratuito. Luego Ajustes > General > VPN y gestion de dispositivos > confiar." -ForegroundColor Gray
Write-Host "   La firma gratuita caduca a los 7 dias (se re-sideloadea)." -ForegroundColor Gray
if (-not $ApiUrl) {
  Write-Host ""
  Warn "Compilaste con API=localhost. En un celular/iPhone REAL eso no apunta a tu PC."
  Write-Host '   Vuelve a correr con:  .\build-mobile.ps1 -ApiUrl "https://TU-URL-PUBLICA/api"' -ForegroundColor DarkYellow
}

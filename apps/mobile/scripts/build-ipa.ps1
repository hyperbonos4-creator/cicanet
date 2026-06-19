# Construye el .ipa de CICANET en GitHub Actions (Mac en la nube, sin necesidad
# de Mac local) y lo descarga al Escritorio. Replica el flujo de URBAN.
#
# Requisitos:
#   - GitHub CLI instalado y autenticado:  gh auth login
#   - El repo de CICANET debe tener remoto en GitHub y el workflow ios-build.yml.
#
# Uso:
#   ./build-ipa.ps1                              # API por defecto (localhost)
#   ./build-ipa.ps1 -ApiUrl "https://xxxx.ngrok-free.app/api"   # para iPhone real
#
# Tras descargarlo, instala el .ipa en tu iPhone con Sideloadly (Windows) usando
# un Apple ID gratuito. La firma gratuita caduca a los 7 dias (se re-sideloadea).

param(
  [string]$ApiUrl = ""
)

$ErrorActionPreference = "Stop"
$workflow = "ios-build.yml"
$artifact = "cicanet_mobile-unsigned-ipa"
$desktop  = [Environment]::GetFolderPath("Desktop")

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "No se encontro 'gh' (GitHub CLI). Instala desde https://cli.github.com/ y corre 'gh auth login'."
}

Write-Host "Disparando el build iOS en GitHub Actions..." -ForegroundColor Cyan
if ($ApiUrl -ne "") {
  gh workflow run $workflow -f api_base_url=$ApiUrl
} else {
  gh workflow run $workflow
}

Start-Sleep -Seconds 6
$runId = (gh run list --workflow=$workflow --limit 1 --json databaseId --jq ".[0].databaseId")
Write-Host "Run #$runId iniciado. Esperando a que compile (puede tardar ~10-15 min)..." -ForegroundColor Cyan
gh run watch $runId --exit-status

Write-Host "Descargando el .ipa al Escritorio..." -ForegroundColor Cyan
$dest = Join-Path $desktop "cicanet-ipa"
gh run download $runId -n $artifact -D $dest

$ipa = Get-ChildItem -Path $dest -Filter *.ipa -Recurse | Select-Object -First 1
if ($ipa) {
  $final = Join-Path $desktop "cicanet_mobile.ipa"
  Copy-Item $ipa.FullName $final -Force
  Write-Host "Listo: $final" -ForegroundColor Green
  Write-Host "Instalalo en tu iPhone con Sideloadly." -ForegroundColor Green
} else {
  Write-Error "No se encontro el .ipa en la descarga."
}

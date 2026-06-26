<#
============================================================
 CICANET · Script MAESTRO de despliegue
 ------------------------------------------------------------
 Hace TODO en un solo comando:
   1) VALIDA en local  : prisma generate + typecheck API + typecheck Web + tests
   2) SUBE a GitHub     : git add/commit/push a la rama destino
   3) DESPLIEGA en Oracle (server2): git pull + (opcional) prisma db push +
      restart de contenedores + verificacion de logs (sin errores).

 Si la validacion local FALLA, NO sube ni despliega nada.

 Uso (desde cualquier carpeta):
   powershell -ExecutionPolicy Bypass -File scripts\deploy-master.ps1 -Message "feat: ..."

 Parametros utiles:
   -Message "<msg commit>"     Mensaje del commit (obligatorio en la practica)
   -Branch  feat/...           Rama destino (def: feat/contabilidad-parte-ii)
   -PrismaPush                 Corre 'prisma db push' en el server (si cambio el schema)
   -SkipTests                  Omite los tests de Jest
   -SkipWeb                    Omite el typecheck del frontend
   -NoServer                   Solo valida + push (no toca el server)
   -NoPush                     Solo valida en local (no sube nada)
   -KeyPath "<ruta .key>"      Ruta de la llave SSH del server2
============================================================
#>

[CmdletBinding()]
param(
  [string]$Message = "",
  [string]$Branch = "feat/contabilidad-parte-ii",
  [string]$ServerUser = "ubuntu",
  [string]$ServerHost = "157.137.223.29",
  [string]$ServerDir = "~/cicanet-demo",
  [string]$KeyPath = "",
  [switch]$PrismaPush,
  [switch]$SkipTests,
  [switch]$SkipWeb,
  [switch]$NoServer,
  [switch]$NoPush
)

$ErrorActionPreference = "Continue"
# Nota: validamos cada paso por su codigo de salida ($LASTEXITCODE), no por stderr.
# git/npm/tsc escriben avisos (warnings) a stderr que NO deben abortar el flujo.

# ---- helpers de salida ----
function Hd($t){ Write-Host "`n========== $t ==========" -ForegroundColor Cyan }
function Ok($t){ Write-Host "OK  $t" -ForegroundColor Green }
function Warn($t){ Write-Host "ADVERTENCIA  $t" -ForegroundColor Yellow }
function Die($t){ Write-Host "ERROR  $t" -ForegroundColor Red; exit 1 }

# ---- localizar repo y herramientas ----
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoRoot "apps\api\prisma\schema.prisma"))) {
  Die "No encuentro el repo (esperaba apps\api\prisma\schema.prisma bajo $RepoRoot)."
}

# Node (anade C:\Program Files\nodejs al PATH si hace falta)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = "C:\Program Files\nodejs"
  if (Test-Path (Join-Path $nodeDir "node.exe")) { $env:Path = "$nodeDir;$env:Path" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js no esta instalado (winget install OpenJS.NodeJS.LTS)." }

# Git
$GitExe = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $GitExe) { foreach($p in @("C:\Program Files\Git\cmd\git.exe","C:\Program Files\Git\bin\git.exe")){ if(Test-Path $p){ $GitExe=$p } } }
if (-not $GitExe) { Die "Git no esta instalado (winget install Git.Git)." }

# Binarios locales del monorepo (hoisted en la raiz)
$Tsc    = Join-Path $RepoRoot "node_modules\typescript\bin\tsc"
$Prisma = Join-Path $RepoRoot "node_modules\prisma\build\index.js"
$Jest   = Join-Path $RepoRoot "node_modules\jest\bin\jest.js"
$SchemaApi = Join-Path $RepoRoot "apps\api\prisma\schema.prisma"

# Llave SSH del server2 (auto-deteccion)
if (-not $KeyPath) {
  foreach($k in @("$env:USERPROFILE\.ssh\cicanet_server2.key", "C:\Users\Hide\Music\ssh-key-server2.key")) {
    if (Test-Path $k) { $KeyPath = $k; break }
  }
}

function Run($label, [scriptblock]$block) {
  Write-Host "-> $label ..." -ForegroundColor DarkGray
  & $block
  if ($LASTEXITCODE -ne 0) { Die "$label fallo (exit $LASTEXITCODE)." }
  Ok $label
}

# ============================================================
#  1) VALIDACION LOCAL
# ============================================================
Hd "1/3  VALIDACION LOCAL"

Run "Prisma generate" { & node $Prisma generate --schema $SchemaApi }
Run "Typecheck API (tsc)" { & node $Tsc -p (Join-Path $RepoRoot "apps\api\tsconfig.json") --noEmit }

if (-not $SkipWeb) {
  Run "Typecheck Web (tsc)" { & node $Tsc -p (Join-Path $RepoRoot "apps\web\tsconfig.json") --noEmit }
} else { Warn "Typecheck Web omitido (-SkipWeb)." }

if (-not $SkipTests) {
  Run "Tests API (jest)" { & node $Jest --config (Join-Path $RepoRoot "apps\api\jest.config.js") --silent }
} else { Warn "Tests omitidos (-SkipTests)." }

Ok "Validacion local COMPLETA (compila y pasa pruebas)."

if ($NoPush) { Write-Host "`n-NoPush: termino aqui (solo validacion)." -ForegroundColor Cyan; exit 0 }

# ============================================================
#  2) GIT: commit + push
# ============================================================
Hd "2/3  GIT (commit + push a $Branch)"

& $GitExe config --global --add safe.directory '*' 2>&1 | Out-Null
& $GitExe -C $RepoRoot add -A
$pending = (& $GitExe -C $RepoRoot status --porcelain)
if (-not $pending) {
  Warn "No hay cambios para commitear. Continuo al despliegue (puede que ya este subido)."
} else {
  if (-not $Message) { $Message = "deploy: cambios $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
  & $GitExe -C $RepoRoot commit -m $Message | Out-Host
  if ($LASTEXITCODE -ne 0) { Die "git commit fallo." }
  Ok "Commit creado."
}

# Push (con token de scripts/.gh-token si existe; si no, credenciales cacheadas)
$tokFile = Join-Path $RepoRoot "scripts\.gh-token"
$origin = (& $GitExe -C $RepoRoot remote get-url origin).Trim()
if (Test-Path $tokFile) {
  $tok = (Get-Content $tokFile -Raw).Trim()
  $pushUrl = $origin.Replace("https://", "https://$tok@")
  $out = (& $GitExe -C $RepoRoot push $pushUrl "HEAD:$Branch" 2>&1) -join "`n"
  $code = $LASTEXITCODE
  $out = $out.Replace($tok, "***TOKEN***")
} else {
  $out = (& $GitExe -C $RepoRoot push origin "HEAD:$Branch" 2>&1) -join "`n"
  $code = $LASTEXITCODE
}
Write-Host $out
# git escribe avisos (LFS, CRLF) a stderr aunque el push tenga exito: validamos por codigo de salida.
if ($code -ne 0 -or $out -match "\[rejected\]|! \[remote rejected\]|fatal:") { Die "git push fallo (exit $code; revisa el mensaje de arriba)." }
Ok "Push a $Branch completado."

if ($NoServer) { Write-Host "`n-NoServer: termino aqui (no toco el server)." -ForegroundColor Cyan; exit 0 }

# ============================================================
#  3) DESPLIEGUE EN ORACLE (server2)
# ============================================================
Hd "3/3  DESPLIEGUE EN ORACLE ($ServerUser@$ServerHost)"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Die "ssh no disponible (OpenSSH client)." }
if (-not $KeyPath -or -not (Test-Path $KeyPath)) {
  Die "No encuentro la llave SSH del server2. Pasa -KeyPath '<ruta ssh-key-server2.key>'."
}

# Construye el script remoto (LF, sin CR) para evitar errores de bash con \r
$prismaLine = if ($PrismaPush) { "sudo docker compose exec -T api npm run prisma:push" } else { "echo '(prisma db push omitido; usa -PrismaPush si cambio el schema)'" }
$remoteLines = @(
  "set -e",
  "cd $ServerDir",
  "git stash push -m predeploy docker-compose.yml >/dev/null 2>&1 || true",
  "git pull origin $Branch",
  "git stash pop >/dev/null 2>&1 || true",
  $prismaLine,
  "sudo docker compose restart api web",
  "echo '=== esperando arranque ==='",
  "sleep 7",
  "echo '=== LOGS API (ultimas 40) ==='",
  "sudo docker compose logs --tail=40 api | grep -iE 'error|infra|nest application|Found [0-9]+ error' || true"
)
$remote = ($remoteLines -join "`n").Replace("`r","")

$sshOpts = @(
  "-i", $KeyPath,
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "IdentitiesOnly=yes",
  "-o", "ConnectTimeout=15",
  "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa"
)

Write-Host "-> Conectando y desplegando en el server ..." -ForegroundColor DarkGray
$serverOut = ($remote | ssh @sshOpts "$ServerUser@$ServerHost" "bash -s" 2>&1) -join "`n"
Write-Host $serverOut

# Verificacion final: detectar errores de compilacion en el server
if ($serverOut -match "Found \d+ error" -or $serverOut -match "error TS\d+") {
  Die "El server reporto errores de compilacion (revisa los logs de arriba)."
}
if ($serverOut -match "Nest application successfully started") {
  Ok "API arranco correctamente en el server (Nest started, sin errores TS)."
} else {
  Warn "No vi 'Nest application successfully started' en las ultimas lineas. Revisa los logs manualmente."
}

Hd "DESPLIEGUE COMPLETO"
Write-Host "Local validado -> push a $Branch -> desplegado en $ServerHost." -ForegroundColor Green

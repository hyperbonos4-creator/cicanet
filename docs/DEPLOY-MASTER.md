# CICANET · Runbook MAESTRO de despliegue (local → GitHub → Oracle)

> Procedimiento único para **validar en local**, **subir a GitHub** y **desplegar en
> el servidor Oracle (server2)** cualquier cambio del backend/frontend, dejando la
> API compilando **sin errores**.
>
> ⚠️ Contiene rutas, host y referencias a secretos. Trátalo como **confidencial**.

---

## 0. Mapa rápido

| Pieza | Valor |
|-------|-------|
| Repo | `https://github.com/hyperbonos4-creator/cicanet.git` |
| Rama de trabajo | `feat/contabilidad-parte-ii` |
| Carpeta de trabajo (PC nuevo) | `Z:\cicanet` (= `\\192.168.1.33\Compartido\cicanet`) |
| Servidor (demo CICANET) | **server2** · Oracle Cloud Bogotá · `ubuntu@157.137.223.29` |
| Carpeta en el server | `~/cicanet-demo` |
| Llave SSH del server2 | `ssh-key-server2.key` (en el PC: `%USERPROFILE%\.ssh\cicanet_server2.key`; original en `C:\Users\Hide\Music\`) |
| Stack en el server | Docker Compose (api, web, postgres, redis, minio, martin, evolution) |

> Nota: la llave del **server1** (URBAN, `157.137.230.190`) es **distinta**:
> `ssh-key-2026-06-11.key`. No sirve para el server2. Cada `ssh -i` usa la llave de **ese** server.

---

## 1. Prerrequisitos (una sola vez por PC)

```powershell
winget install OpenJS.NodeJS.LTS --source winget --silent --accept-package-agreements --accept-source-agreements
winget install Git.Git           --source winget --silent --accept-package-agreements --accept-source-agreements
```

- El repo vive en un recurso de red → marca el repo como seguro para git:
  ```powershell
  git config --global --add safe.directory '*'
  ```
- Copia la llave SSH del server2 a una ruta local con permisos restringidos:
  ```powershell
  Copy-Item "C:\Users\Hide\Music\ssh-key-server2.key" "$env:USERPROFILE\.ssh\cicanet_server2.key" -Force
  icacls "$env:USERPROFILE\.ssh\cicanet_server2.key" /inheritance:r /grant:r "$($env:USERNAME):R"
  ```
- `node`/`npm.ps1` puede estar bloqueado por la política de PowerShell. Por eso el script
  maestro invoca las herramientas con `node <ruta>` directamente (no depende de `npm` global).

---

## 2. Camino con UN solo comando (recomendado)

Desde la raíz del repo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-master.ps1 -Message "feat(infra): mi cambio"
```

Esto, en orden y **abortando si algo falla**:

1. **Valida en local**: `prisma generate` → typecheck **API** → typecheck **Web** → **tests** (Jest).
2. **Sube a GitHub**: `git add -A` → `commit` → `push` a `feat/contabilidad-parte-ii`
   (usa el token de `scripts/.gh-token` si existe).
3. **Despliega en Oracle**: `git pull` → (opcional) `prisma db push` → `restart api web`
   → muestra los logs y verifica que **no haya errores** y que aparezca
   `Nest application successfully started`.

### Variantes útiles

```powershell
# Cambié el schema de Prisma (tablas nuevas) → crea las tablas en el server:
... scripts\deploy-master.ps1 -Message "feat: tablas X" -PrismaPush

# Solo validar en local (no sube nada):
... scripts\deploy-master.ps1 -NoPush

# Validar + subir, sin tocar el server:
... scripts\deploy-master.ps1 -Message "wip" -NoServer

# Omitir pruebas o el typecheck web (más rápido):
... scripts\deploy-master.ps1 -Message "x" -SkipTests -SkipWeb

# Llave SSH en otra ruta:
... scripts\deploy-master.ps1 -Message "x" -KeyPath "C:\Users\Hide\Music\ssh-key-server2.key"
```

---

## 3. Camino MANUAL (si prefieres paso a paso)

### 3.1 Validar en local (¡antes de subir!)
```powershell
$node = "C:\Program Files\nodejs\node.exe"
# 1) cliente Prisma al día
& $node "Z:\cicanet\node_modules\prisma\build\index.js" generate --schema "Z:\cicanet\apps\api\prisma\schema.prisma"
# 2) typecheck backend (debe terminar SIN 'error TS')
& $node "Z:\cicanet\node_modules\typescript\bin\tsc" -p "Z:\cicanet\apps\api\tsconfig.json" --noEmit
# 3) typecheck frontend
& $node "Z:\cicanet\node_modules\typescript\bin\tsc" -p "Z:\cicanet\apps\web\tsconfig.json" --noEmit
# 4) pruebas del dominio
& $node "Z:\cicanet\node_modules\jest\bin\jest.js" --config "Z:\cicanet\apps\api\jest.config.js"
```
> Si cualquiera falla, **corrige y repite**. No subas código que no compila.

### 3.2 Subir a GitHub
```powershell
$git = "C:\Program Files\Git\cmd\git.exe"
& $git -C "Z:\cicanet" add -A
& $git -C "Z:\cicanet" commit -m "feat(infra): mi cambio"
& $git -C "Z:\cicanet" push origin HEAD:feat/contabilidad-parte-ii
```

### 3.3 Desplegar en el server (por SSH)
```powershell
ssh -i "$env:USERPROFILE\.ssh\cicanet_server2.key" -o PubkeyAcceptedAlgorithms=+ssh-rsa ubuntu@157.137.223.29
```
Ya **dentro del server**:
```bash
cd ~/cicanet-demo
git stash push -m predeploy docker-compose.yml 2>/dev/null   # preserva el compose del demo
git pull origin feat/contabilidad-parte-ii
git stash pop 2>/dev/null || true

# Solo si cambió el schema de Prisma (tablas nuevas) — es aditivo y seguro:
sudo docker compose exec -T api npm run prisma:push

sudo docker compose restart api web
```

### 3.4 Verificar que NO hay errores
```bash
# Logs de la API: NO debe aparecer 'Found N errors'; SÍ 'Nest application successfully started'
sudo docker compose logs --tail=40 api | grep -iE "error|infra|nest application"

# (Si tocaste el schema) las tablas deben existir:
sudo docker exec cicanet-postgres psql -U cicanet -d cicanet -tAc \
  "select tablename from pg_tables where tablename in ('puerto','conexion');"
```

---

## 4. Reglas y aprendizajes (importantes)

- **Compila en local antes de subir.** El watcher del server (`nest start --watch`)
  recompila al hacer `pull`; si el código no compila, la API queda en
  `Found N errors` y **no arranca**. El script maestro evita esto validando primero.
- **El typecheck debe verse de verdad.** En este entorno el shell a veces no captura
  bien la salida; valida por **exit code** (`$LASTEXITCODE -eq 0`) o con `tsc` en proceso
  dedicado, no por "el archivo de log salió vacío".
- **`prisma db push` es aditivo** para tablas nuevas (no toca las existentes), pero
  corre solo cuando cambió el schema. Si no cambió, dirá *"already in sync"*.
- **El `docker-compose.yml` del server está modificado** (puertos a loopback por
  `deploy-demo.sh`). El `git stash` del procedimiento lo preserva durante el `pull`.
- **Sube desde `Z:\cicanet`**, no desde otra copia local: los cambios viven ahí.
- **Nunca** commitees `.env`, `scripts/.gh-token`, `*.key`/`*.pem` ni `node_modules`.

---

## 5. Rollback rápido

Si un despliegue deja la API con errores y necesitas volver atrás:
```bash
cd ~/cicanet-demo
git log --oneline -5                      # ubica el commit bueno anterior
git reset --hard <commit_bueno>           # ⚠️ descarta el código al estado de ese commit
sudo docker compose restart api web
```
> `prisma db push` no borra columnas/tablas existentes; un rollback de código no
> elimina tablas ya creadas (quedan vacías y sin uso, sin afectar el resto).

---

## 6. Estado actual (referencia)

- Capa de **conectividad a nivel puerto** + **trazado óptico** + **export OFDS**
  desplegada en server2 (commits `9ae6425` y fix `1a8ecd7` sobre `feat/contabilidad-parte-ii`).
- Tablas `puerto` y `conexion` creadas en PostgreSQL del server.
- API: `Nest application successfully started`, log de Infra `… puertos · … conexiones`.

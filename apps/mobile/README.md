# CICANET · App del cliente (Flutter)

App móvil del cliente de CICANET. Arquitectura replicada de la app URBAN
(Flutter + Riverpod + go_router + dio + secure_storage + socket.io) con el
design system **UDS** rebrandeado a CICANET (navy + dorado).

## Estructura

```
lib/
├── main.dart                 # Arranque, tema, router
├── core/
│   ├── api/                  # dio_client (JWT + refresh) + providers
│   ├── realtime/             # socket_client (/realtime)
│   ├── router/               # go_router + redirección por auth
│   ├── storage/              # secure_storage (tokens)
│   ├── theme/                # UDS tokens + AppTheme (Material 3)
│   └── uds/                  # Design system: button, card, input, kpi, etc.
└── features/
    ├── auth/                 # login + auth_notifier
    ├── splash/               # arranque
    ├── shell/                # navegación inferior
    ├── home/                 # estado del servicio
    ├── facturas/             # facturas (P1/P3)
    ├── dispositivos/         # blacklist TR-069 (P7)
    └── profile/              # perfil + logout
```

## Requisitos previos

- Flutter SDK 3.5+ (`flutter --version`).

## Generar las carpetas de plataforma (primera vez)

Este repo trae solo `lib/` + `pubspec.yaml`. Genera Android/iOS sin sobrescribir el código:

```bash
cd apps/mobile
flutter create --org co.cicanet --project-name cicanet_mobile --platforms=android,ios .
flutter pub get
```

## Correr

La app apunta por defecto a `http://localhost:4000/api`. Para apuntar a otra IP/host:

```bash
# Emulador Android (host del PC = 10.0.2.2)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
            --dart-define=REALTIME_BASE_URL=http://10.0.2.2:4000/realtime

# Dispositivo físico por USB (recomendado)
adb reverse tcp:4000 tcp:4000
flutter run
```

Credenciales de prueba (semilla del backend): `admin` / `cicanet2026`.

## Estado

- ✅ Núcleo: auth (login + refresh), router, tema, storage, socket, design system.
- ✅ Pantallas: splash, login, shell, inicio, facturas, dispositivos, perfil.
- ⏳ Datos reales del cliente (plan, facturas, dispositivos): dependen del
  **portal/endpoints del cliente** (PLAN-MAESTRO P5/P6) y de facturación (P1).
- ⏳ Push (FCM) y pago Wompi embebido: siguientes incrementos.

## Compilar Android (.apk) + iOS (.ipa) con un solo comando

El `.ipa` de iOS **solo** se puede compilar en macOS (regla de Apple), así que
ambos binarios se compilan en la **nube de GitHub Actions** (Linux para el `.apk`,
un Mac para el `.ipa`, gratis y en paralelo). No necesitas Mac ni Android SDK
local. El script hace push, dispara el build, muestra el avance y baja **los dos
al Escritorio**.

**Requisitos (una vez):**
- El repo con remoto `origin` en GitHub (ya está).
- Un token de GitHub (PAT) con permisos **Contents** (push) y **Actions**
  (leer ejecuciones + descargar artefactos). Genéralo en GitHub → Settings →
  Developer settings → Personal access tokens.

**Ejecutar (manual):**
```powershell
cd apps/mobile/scripts

# API por defecto (localhost — para el emulador):
.\build-mobile.ps1

# Apuntando la app a tu backend público (para celular/iPhone reales):
.\build-mobile.ps1 -ApiUrl "https://TU-URL-PUBLICA/api"
```
El token se pasa con `-Token`, por la variable de entorno `GH_TOKEN`, o el
script lo pide al arrancar. Resultado: `cicanet_mobile.apk` y `cicanet_mobile.ipa`
en el Escritorio.

**Instalar:**
- **Android (.apk):** cópialo al celular e instálalo (activa "orígenes
  desconocidos"). Va firmado con la clave de depuración (instalable directo).
- **iOS (.ipa, sin firma):** Sideloadly (https://sideloadly.io) + Apple ID
  gratuito. Luego Ajustes → General → VPN y gestión de dispositivos → confiar.
  La firma gratuita caduca a los **7 días** (se re-sideloadea).

> ⚠️ En un celular/iPhone REAL `localhost` no apunta a tu PC: compila con la
> **URL pública https** del backend (`-ApiUrl`). iOS (ATS) bloquea http.

> También puedes lanzarlo a mano: GitHub → Actions → "Mobile Build (APK + IPA)"
> → Run workflow (campo opcional para la URL del API) → descarga los artefactos.


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

## iOS (.ipa) sin Mac

Igual que en URBAN, el `.ipa` se compila en un **Mac de GitHub Actions** (gratis)
y se descarga para instalarlo con **Sideloadly** en Windows. No necesitas Mac.

**Requisito (una vez):** el repo debe estar en GitHub.
```bash
# desde la raíz del monorepo
git add . && git commit -m "CICANET: app movil + workflow iOS"
gh repo create cicanet --private --source=. --push
```

**Compilar y bajar el .ipa al Escritorio:**
```powershell
# opcion A: script (requiere GitHub CLI 'gh' autenticado)
cd apps/mobile/scripts
./build-ipa.ps1 -ApiUrl "https://TU-URL-PUBLICA/api"   # iPhone real (ngrok/dominio)

# opcion B: manual
#   GitHub -> Actions -> "iOS Build (IPA sin firma)" -> Run workflow
#   (opcional: pega la URL publica del API) -> descarga el artefacto.
```

**Instalar en el iPhone:** Sideloadly (https://sideloadly.io) + Apple ID gratuito.
Luego Ajustes -> General -> VPN y gestion de dispositivos -> confiar en el perfil.
La firma gratuita caduca a los **7 dias** (se vuelve a sideloadear).

> ⚠️ En el iPhone real `localhost` no apunta a tu PC: compila el `.ipa` con la
> **URL publica https** del backend (`-ApiUrl`). iOS (ATS) bloquea http.


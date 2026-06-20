# einvoice — Microservicio de Facturación Electrónica DIAN (CICANET)

Microservicio interno (FastAPI + facho) que firma (XAdES), construye UBL 2.1 y
envía documentos electrónicos a la DIAN: facturas, notas crédito/débito y
documento soporte. Industrializado desde el proyecto `zeroset`.

## Seguridad (importante)

- **No se expone a internet.** Solo es accesible por el backend en la red
  interna de Docker (`cicanet-net`). No tiene `ports` publicados.
- **Autenticación por API-key**: toda petición (salvo `/api/health`) exige el
  header `X-API-Key` igual a `EINVOICE_API_KEY`. Si la variable no está
  configurada, el servicio rechaza todo (fail-closed).
- **Sin secretos en el código.** La contraseña del certificado llega por
  `CERT_PASSWORD` (env/secret). Los certificados se cargan por la API y
  persisten en el volumen `einvoice_certs` (carpeta `certificados/<NIT>/`).
- El `.gitignore` impide versionar `*.pfx/*.pem/*.key`, `config_*.py` y los
  certificados por NIT.

## Variables de entorno

| Variable                | Descripción                                            |
|-------------------------|--------------------------------------------------------|
| `EINVOICE_API_KEY`      | Clave compartida con el backend (header `X-API-Key`).  |
| `CERT_PASSWORD`         | Contraseña del `.pfx` de CICANET.                      |
| `EINVOICE_CORS_ORIGINS` | Orígenes CORS permitidos (default: backend interno).   |

## Puesta en marcha con certificados de CICANET (pendiente)

1. Obtener de CICANET: certificado digital de firma (Certicámara u otra CA),
   habilitación del software ante la DIAN (Software ID, PIN, clave técnica) y la
   resolución de numeración (prefijo, rango, fechas).
2. Cargar el certificado por la API (`POST /api/config/certificado-validar-certicamara`
   con header `X-Company-Nit: <NIT_CICANET>`), que valida PFX+CER+KEY y los guarda
   en `certificados/<NIT>/`.
3. Parametrizar emisor + DIAN en el backend: `POST /api/invoicing/config`
   (rol admin) con `{ emisor, dian }`. Esto se guarda en `Setting`.
4. Emitir: `POST /api/invoicing/facturas`. El backend arma el payload, llama a
   este servicio y **contabiliza el ingreso en el ledger** (Dr 130505 CxC, Cr
   414505 Ingreso, Cr 240805 IVA).

## Endpoints principales

- `GET  /api/health` — salud (sin key).
- `GET  /api/certificate/status` — estado de certificados del NIT.
- `POST /api/invoice/generate-xml` — genera XML firmado (sin enviar).
- `POST /api/invoice/generate-and-send` — firma y envía a la DIAN.
- `POST /api/dian/nota-ajuste` — nota crédito/anulación.
- `GET  /api/dian/documentos/{nit}/{filename}/pdf` — representación gráfica (PDF+QR).

## Pendiente / deuda técnica

- `facho` está **vendorizado** (carpeta `facho/`): su upstream fue archivado, así
  que CICANET es ahora el mantenedor. Migración futura sugerida a `ubl-builder`
  (TypeScript) para unificar el stack y salir de la dependencia GPL en Python.
- Reescribir los scripts `enviar_*.py` (heredados) como casos de uso del API.

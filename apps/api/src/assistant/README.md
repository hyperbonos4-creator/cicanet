# Asistente "Cica" — arquitectura

Agente operativo de soporte de CICANET. No es un FAQ-bot: razona y consulta
herramientas reales (function calling) para responder con datos vivos. Degrada
con elegancia a la base de conocimiento (FAQ) si no hay LLM configurado.

## Piezas

- `assistant.controller.ts` — `POST /assistant/chat` y `/assistant/ask` (requiere
  sesión JWT). Pasa `role` y `clienteId` del token al servicio.
- `assistant.service.ts` — bucle del agente: plan → ejecutar herramientas (en
  paralelo) → sintetizar. Presupuesto de tiempo acotado (`ASSISTANT_BUDGET_MS`)
  para que la petición HTTP nunca se cuelgue con modelos locales lentos.
- `llm.provider.ts` — cliente LLM agnóstico (API estilo OpenAI). Sirve Gemini,
  OpenAI, Groq, OpenRouter u **Ollama local** cambiando solo env. Quita el bloque
  `<think>` de modelos "thinking" antes de devolver.
- `agent-tools.service.ts` — herramientas reales, **filtradas por rol**.
- `project-explorer.service.ts` — copiloto de código (solo lectura).
- `knowledge.ts` — FAQ, mapa real de la app (anti-alucinación) y datos de empresa.

## Modelo

Por defecto Ollama local. En este despliegue: `qwen3-coder:30b` (especializado en
código, contexto 262k, soporta tools) — ideal para el copiloto. Cambiar de modelo
o proveedor = cambiar `ASSISTANT_*` en `.env`, no código.

## Herramientas por rol (RBAC en dos capas)

El rol viene del JWT. La autorización se aplica **dos veces** (defensa en
profundidad):

1. `schemas(rol)` — el modelo solo *ve* las herramientas permitidas para su rol.
2. `execute()` — cortafuegos por nombre: aunque el modelo invente una llamada a
   una herramienta de mayor privilegio, devuelve `{ error: 'no_autorizado' }`.

| Grupo            | Roles            | Herramientas |
|------------------|------------------|--------------|
| Autoservicio     | todos            | `verificar_cobertura`, `info_pagos`, `crear_link_pago`, `contacto_asesor`, `info_planes`, `consultar_funciones_app`, `mi_servicio`, `mis_facturas`, `diagnosticar_servicio`, `crear_ticket` |
| Operación (CRM/NOC) | admin, operador | `buscar_cliente`, `resumen_cliente`, `estado_red`, `buscar_ordenes`, `listar_tickets` |
| Copiloto de código | **solo admin** | `explorar_proyecto`, `buscar_en_codigo`, `leer_archivo` |

## Copiloto de código — seguridad (no negociable)

Un asistente de cara al cliente **nunca** debe leer código ni archivos del
servidor (ahí viven `.env`, llaves Wompi, JWT, tokens). El copiloto:

- Es **solo admin** y **solo lectura** (sin escribir, mover ni ejecutar).
- Solo ve el monorepo montado en `/workspace:ro` (`CODE_ROOT`). No puede salir de
  la raíz (anti path-traversal con rutas resueltas).
- **Bloquea** carpetas/archivos sensibles: `node_modules`, `.git`, `dist`, `.env`,
  `*.pem|*.key|*.p12|keystore|...`. Solo abre extensiones de texto/código.
- **Redacta** valores que parezcan secretos (`secret`, `password`, `token`,
  `api_key`, `bearer`, `wompi`, `integrity`…) en el contenido devuelto.
- Límites de tamaño (600 KB), de líneas y de resultados para no inflar el
  contexto del modelo (latencia).

Verificado: lee archivos de código reales y responde por su contenido; **rechaza**
`.env` ("archivo protegido") sin filtrar secretos.

## Por qué herramientas en vez de fine-tuning

"Entrenar" a Cica sobre CICANET = darle **acceso a la verdad en vivo** (BD, red,
código), no memorizar un dataset que queda obsoleto. El tool-calling sobre fuentes
reales evita alucinaciones y refleja siempre el estado actual del sistema.

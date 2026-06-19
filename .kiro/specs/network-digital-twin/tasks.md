# Implementation Plan: Gemelo Digital de la Red (network-digital-twin)

## Overview

El plan evoluciona el módulo `network` actual (`apps/api/src/network`, almacenamiento en memoria/JSON y geometría con Turf) hacia un módulo de dominio `infra` con servicios cohesivos, repositorios abstractos (in-memory + PostGIS) y una UI de mapa evolucionada (`apps/web`, MapLibre + paneles). La implementación es en **TypeScript** (NestJS en el backend, Next.js en el frontend), con **fast-check** para las pruebas de propiedad y **Jest** como runner.

El enfoque es incremental: primero los tipos de dominio y la lógica pura (validación, topología, capacidad, penetración, construcción, impacto, filtrado por vista/bbox) con sus pruebas de propiedad cerca de cada implementación; luego los repositorios in-memory, los servicios de dominio, los controllers con RBAC, la persistencia PostGIS, el tiempo real y por último el cableado de la UI. Cada paso se integra con los anteriores; no queda código huérfano.

## Tasks

- [x] 1. Configurar el módulo `infra` y los tipos de dominio
  - [x] 1.1 Crear el scaffolding del módulo `infra` y el modelo de dominio
    - Crear `apps/api/src/infra/` con `infra.module.ts` (reutilizando `AuthModule`, `GeoModule`, `RolesGuard`)
    - Definir en `apps/api/src/infra/domain/types.ts` los tipos del modelo: `AssetType`, `AssetStatus`, `OwnershipRegime`, `MonitorProtocol`, `Asset`, `Economics`, `Risk`, `PhotoRef`, `DocRef`, `AssetEvent`, `TypeAttributes` (unión discriminada R4.1–R4.8), `Nap`, `Site`, `FiberSegment`, `CoverageArea`, `Sector`, `Actor`, `LngLat`, `Polygon`, `LineString`
    - Configurar Jest + fast-check en `apps/api` (devDependencies y script `test`) para habilitar las pruebas de propiedad y unitarias
    - Registrar `InfraModule` en `app.module.ts` (sin remover aún `NetworkModule`)
    - _Requirements: 1.1, 1.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [ ] 2. Implementar validación de activos y la ficha universal
  - [x] 2.1 Implementar helpers puros de validación de activos
    - En `apps/api/src/infra/domain/asset-validation.ts`: validar `tipo` y `estado` contra sus dominios cerrados, exigir `tipo` + coordenadas GPS, y exigir `regimen` válido cuando `propio = false`
    - Devolver mensajes de error que nombran el campo obligatorio o la causa
    - _Requirements: 1.1, 1.4, 1.5, 1.7_

  - [x]* 2.2 Escribir pruebas de propiedad para la validación de activos
    - **Property 1: Validación de campos de enumeración** — **Validates: Requirements 1.1, 1.4**
    - **Property 2: Régimen obligatorio para activos no propios** — **Validates: Requirements 1.5**
    - **Property 3: Obligatoriedad de tipo y coordenadas** — **Validates: Requirements 1.7**

  - [ ] 2.3 Definir interfaces de repositorio e implementar `InMemoryAssetRepository`
    - En `apps/api/src/infra/repositories/asset.repository.ts`: interfaz `AssetRepository` (CRUD + consultas) e implementación in-memory que evoluciona los `.json` actuales
    - Definir también las interfaces `SiteRepository`, `FiberRepository`, `SectorRepository`, `CoverageRepository`
    - _Requirements: 1.2, 1.3, 1.6, 1.8_

  - [ ] 2.4 Implementar `AssetService` (crear, editar, consultar)
    - En `apps/api/src/infra/services/asset.service.ts`: `create`/`update` aplicando la validación de 2.1, `get` devolviendo la ficha con atributos por tipo, riesgo, fotos y documentos
    - Persistir marca/modelo/serie, dirección/barrio/comuna/ciudad, fecha de instalación, proveedor, gestión IP/puerto/protocolos y los indicadores de riesgo
    - _Requirements: 1.2, 1.3, 1.6, 1.8, 3.4, 5.1, 5.2_

  - [ ]* 2.5 Escribir prueba de propiedad para el round-trip de la ficha
    - **Property 4: Round-trip de la ficha del activo** — **Validates: Requirements 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.2**

  - [ ]* 2.6 Escribir pruebas unitarias del `AssetService`
    - Almacenamiento de campos universales y por tipo, indicadores de riesgo, casos límite de validación
    - _Requirements: 1.2, 1.3, 1.6, 1.8, 3.1, 3.3, 5.1_

- [ ] 3. Implementar la economía del activo
  - [ ] 3.1 Implementar `EconomicsService` y helpers de economía
    - En `apps/api/src/infra/services/economics.service.ts`: almacenar datos económicos, calcular capital desplegado (suma de costo de compra + instalación) y marcar garantía vencida
    - _Requirements: 2.1, 2.2, 2.3_

  - [x]* 3.2 Escribir prueba de propiedad para el capital desplegado
    - **Property 5: Cálculo del capital desplegado** — **Validates: Requirements 2.2**

  - [x]* 3.3 Escribir prueba de propiedad para garantía vencida
    - **Property 6: Garantía vencida** — **Validates: Requirements 2.3**

- [ ] 4. Implementar evidencia e instalación
  - [ ] 4.1 Implementar `EvidenceService` y `markInstalled` en `AssetService`
    - Adjuntar fotos clasificadas {vista general, frontal, placa serial, instalación} y documentos asociados al activo
    - `markInstalled` exige al menos una fotografía; en caso contrario rechaza con mensaje de evidencia obligatoria
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 4.2 Escribir prueba de propiedad para instalación con evidencia
    - **Property 7: Instalación exige evidencia fotográfica** — **Validates: Requirements 3.2**

- [ ] 5. Implementar la topología
  - [x] 5.1 Implementar `topology.ts` (helpers puros) y `TopologyService`
    - En `apps/api/src/infra/domain/topology.ts`: `ancestors`, `descendants`, `wouldCreateCycle` sobre el grafo de `padreId`
    - `TopologyService.setParent` rechaza ciclos; `ancestors`/`descendants` exponen los recorridos
    - _Nota: helpers puros cableados en `InfraService` (getAssetDetail/getBundle/setParent); rechazo de ciclos activo._
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]* 5.2 Escribir prueba de propiedad para la cadena ascendente
    - **Property 8: Cadena de dependencia ascendente** — **Validates: Requirements 7.2**

  - [x]* 5.3 Escribir prueba de propiedad para descendientes y clientes dependientes
    - **Property 9: Descendientes y clientes dependientes** — **Validates: Requirements 7.3, 14.1, 14.4**

  - [x]* 5.4 Escribir prueba de propiedad para el rechazo de ciclos
    - **Property 10: Rechazo de ciclos en la topología** — **Validates: Requirements 7.4**

- [ ] 6. Implementar el modelado de fibra
  - [ ] 6.1 Implementar `FiberService` e `InMemoryFiberRepository`
    - En `apps/api/src/infra/services/fiber.service.ts`: registrar Segmento_Fibra (origen, destino, longitud, trazado LineString), rechazar origen igual a destino, devolver la red de fibra como líneas y la longitud por segmento
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 6.2 Escribir prueba de propiedad para el round-trip del trazado
    - **Property 11: Round-trip del trazado de fibra** — **Validates: Requirements 8.2**

  - [ ]* 6.3 Escribir prueba de propiedad para el trayecto válido
    - **Property 12: Trayecto de fibra válido** — **Validates: Requirements 8.4**

- [ ] 7. Implementar la gestión de capacidad
  - [ ] 7.1 Implementar `capacity.ts` (helpers puros) y `CapacityService`
    - En `apps/api/src/infra/domain/capacity.ts`: `freePorts` (total − usados), `semaphore` (umbrales 75 %/100 %) y validación de `usados ≤ total`
    - `CapacityService.setUsedPorts` rechaza usados > total con mensaje de capacidad inválida
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 7.2 Escribir prueba de propiedad para puertos libres
    - **Property 13: Cálculo de puertos libres** — **Validates: Requirements 9.1**

  - [x]* 7.3 Escribir prueba de propiedad para el semáforo de capacidad
    - **Property 14: Semáforo de capacidad** — **Validates: Requirements 9.2, 9.3, 9.4**

  - [x]* 7.4 Escribir prueba de propiedad para el rechazo de capacidad inválida
    - **Property 15: Rechazo de capacidad inválida** — **Validates: Requirements 9.5**

- [ ] 8. Implementar el modelo de Sitios
  - [ ] 8.1 Implementar `SiteService` e `InMemorySiteRepository`
    - En `apps/api/src/infra/services/site.service.ts`: crear sitio con nombre + coordenadas, asociar activos, devolver activos del sitio y todos los sitios con coordenadas
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 8.2 Escribir pruebas unitarias del `SiteService`
    - Creación, asociación y listado de activos del sitio
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 9. Implementar hogares potenciales y penetración
  - [ ] 9.1 Implementar `penetration.ts` (helpers puros) y `SectorService`
    - En `apps/api/src/infra/domain/penetration.ts`: hogares conectados (clientes activos) y penetración (% o no disponible si estimados = 0)
    - `SectorService` crea sectores con nombre + hogares estimados y expone los cálculos
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x]* 9.2 Escribir prueba de propiedad para hogares conectados
    - **Property 20: Hogares conectados de un sector** — **Validates: Requirements 12.2**

  - [x]* 9.3 Escribir prueba de propiedad para el cálculo de penetración
    - **Property 21: Cálculo de penetración** — **Validates: Requirements 12.3, 12.4**

- [ ] 10. Implementar el modo construcción
  - [x] 10.1 Implementar `construction.ts` (helpers puros) y `ConstructionService`
    - En `apps/api/src/infra/domain/construction.ts`: elegir la NAP de menor Distancia_Tendido por rutas y evaluar viabilidad (libres ≥ 1 AND distancia ≤ distancia_max), con causa `sin_puertos`/`fuera_de_alcance`
    - `ConstructionService.evaluate` devuelve nap, distanciaTendido, puertosLibres, costoEstimado, tiempoEstimado, resultado y causa; almacenar distancia máxima + polígono/calles comerciales de la NAP
    - _Nota: `InfraService.evaluateConstruction` + endpoint `POST /infra/construction/evaluate`, cableado a la UI (pestaña "Vender"). Distancia aproximada por haversine (ruteo real pendiente)._
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x]* 10.2 Escribir prueba de propiedad para la NAP más cercana
    - **Property 22: NAP más cercana por distancia de tendido** — **Validates: Requirements 13.1**

  - [x]* 10.3 Escribir prueba de propiedad para la viabilidad con causa
    - **Property 23: Viabilidad de instalación con causa** — **Validates: Requirements 13.3, 13.4**

- [ ] 11. Implementar el análisis de impacto
  - [x] 11.1 Implementar `ImpactService`
    - En `apps/api/src/infra/services/impact.service.ts`: `byAsset` (clientes dependientes vía topología descendente), `byFiber` (longitud, clientes, NAP, ingresos) y `monthlyRevenue` (suma de planes), reutilizando `topology.ts`
    - _Nota: `impactOf` en `InfraService` calcula clientes dependientes, NAPs aguas abajo e ingresos mensuales (suma de `planMensual`); expuesto en `getAssetDetail` y en la ficha de la UI._
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 11.2 Escribir prueba de propiedad para el impacto de un Segmento_Fibra
    - **Property 24: Impacto de un Segmento_Fibra** — **Validates: Requirements 14.2**

  - [ ]* 11.3 Escribir prueba de propiedad para los ingresos mensuales
    - **Property 25: Ingresos mensuales asociados** — **Validates: Requirements 14.3**

- [ ] 12. Implementar las vistas del mapa, filtrado por bbox y agrupación
  - [ ] 12.1 Implementar `MapService` (proyección por vista, filtrado por bbox y clustering)
    - En `apps/api/src/infra/services/map.service.ts`: filtrar activos contenidos en el bbox, proyectar cada Vista_Mapa (Cobertura, Capacidad coloreada por semáforo, Incidencias = estados de falla, Activos = instalados, Expansión = sectores de baja penetración) y agrupar en clusters cuando el conteo > 1000
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 17.1, 17.2_

  - [ ]* 12.2 Escribir prueba de propiedad para el color de la vista Capacidad
    - **Property 16: Color de la vista Capacidad según semáforo** — **Validates: Requirements 10.2**

  - [ ]* 12.3 Escribir prueba de propiedad para el filtrado por vista
    - **Property 17: Filtrado por vista del mapa** — **Validates: Requirements 10.3, 10.4**

  - [ ]* 12.4 Escribir prueba de propiedad para la vista Expansión
    - **Property 18: Vista Expansión por penetración baja** — **Validates: Requirements 10.5**

  - [ ]* 12.5 Escribir prueba de propiedad para el filtrado por área visible
    - **Property 26: Filtrado de activos por área visible** — **Validates: Requirements 17.1**

  - [ ]* 12.6 Escribir prueba de propiedad para la agrupación por densidad
    - **Property 27: Agrupación por umbral de densidad** — **Validates: Requirements 17.2**

- [ ] 13. Checkpoint — Asegurar que toda la lógica de dominio pasa
  - Ejecutar todas las pruebas de propiedad y unitarias del dominio; si surgen dudas, preguntar al usuario.

- [ ] 14. Implementar la persistencia PostGIS y los controllers con RBAC
  - [ ] 14.1 Crear entidades TypeORM y migraciones PostGIS
    - Tablas `activos`, `sitios`, `segmentos_fibra`, `areas_cobertura`, `sectores` con columnas `geometry(...,4326)`, índices GIST y constraints (enum, origen≠destino, hogares≥0)
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [ ] 14.2 Implementar los repositorios PostGIS
    - `PostgisAssetRepository`, `PostgisSiteRepository`, `PostgisFiberRepository`, `PostgisSectorRepository`, `PostgisCoverageRepository`; contención espacial vía `ST_Contains`/`ST_Intersects`/`ST_DWithin` y filtrado por bbox; cableados por inyección sin cambiar la interfaz pública
    - _Requirements: 15.1, 15.5, 17.1_

  - [ ]* 14.3 Escribir pruebas de integración PostGIS
    - Persistencia y SRID 4326 de punto/línea/polígono y `ST_Contains` para contención punto-en-polígono (contenedor de pruebas)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ] 14.4 Implementar los controllers de `infra` con RBAC
    - `AssetController`, `SiteController`, `FiberController`, `SectorController`, `MapController`, `ConstructionController`, `ImpactController` con `JwtAuthGuard`; mutaciones/borrado `@Roles('admin','operador')`, evidencia/mantenimiento `@Roles('admin','operador','tecnico')`, lectura solo autenticada; DTOs con `class-validator`
    - _Requirements: 6.4, 8.2, 11.1, 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ]* 14.5 Escribir pruebas e2e de RBAC
    - Verificar 200/401/403 por rol (admin, operador, tecnico, anónimo) sobre lectura, mutación, evidencia y borrado
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ] 14.6 Evolucionar `NetworkGateway` a `InfraGateway`
    - Emitir el estado en vivo de activos por Socket.IO reutilizando el handshake JWT actual
    - _Requirements: 10.2, 10.3_

- [ ] 15. Cablear la UI del Mapa de Infraestructura
  - [ ] 15.1 Extender el cliente de API y los tipos del frontend
    - En `apps/web/lib/api.ts`: métodos para `/infra/map/:vista`, fichas, topología, impacto y construcción con tipos compartidos del dominio
    - _Requirements: 10.1, 11.1, 13.2, 14.1_

  - [ ] 15.2 Evolucionar `CoverageMap` con las nuevas fuentes/capas
    - Capas para sitios, segmentos de fibra (LineString real, no recta POP→NAP), cobertura calculada, sectores y capacidad coloreada por semáforo; eliminar el círculo de radio recto
    - _Requirements: 10.1, 10.2, 8.2_

  - [ ] 15.3 Implementar `VistaMapaSwitcher`
    - Selector de las cinco vistas que NO reinicia la cámara al cambiar (conserva centro/zoom, sin `fitBounds`)
    - _Requirements: 10.6_

  - [ ]* 15.4 Escribir prueba de propiedad para la conservación de cámara
    - **Property 19: Conservación de cámara al cambiar de vista** — **Validates: Requirements 10.6**

  - [ ] 15.5 Implementar `FichaActivo`
    - Panel lateral con secciones General, Topología (NAP), Capacidad (NAP), Clientes (NAP) e Historial; se abre al hacer clic en un activo
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 15.6 Implementar los overlays `ModoConstruccion` y `AnalisisImpacto`
    - Overlays que consumen `/infra/construction/evaluate` e `/infra/impact/*` y muestran resultado, distancia, costo, tiempo, clientes/NAP/ingresos
    - _Requirements: 13.2, 14.1, 14.2_

- [ ] 16. Checkpoint final — Asegurar que todas las pruebas pasan
  - Ejecutar la suite completa (propiedad, unitarias, integración y e2e); si surgen dudas, preguntar al usuario.

- [ ]* 17. Prueba de rendimiento del mapa (smoke)
  - [ ]* 17.1 Medir el tiempo de respuesta de la vista del mapa con inventario grande
    - Sembrar 10 000 activos y verificar que `GET /infra/map/:vista?bbox=` responde en ≤ 2 s para un área visible (ejecución única en CI)
    - _Requirements: 17.3_

## Notes

- Las tareas marcadas con `*` son opcionales (pruebas) y pueden omitirse para un MVP más rápido; las tareas de implementación central nunca son opcionales.
- Cada tarea referencia cláusulas específicas de requisitos para trazabilidad.
- Cada propiedad de corrección (Property 1–27) es una sub-tarea independiente, anotada con su número de propiedad y la cláusula de requisito que valida, ubicada cerca de su implementación para detectar errores temprano.
- Los checkpoints aseguran validación incremental.
- La lógica de dominio pura (validación, topología, capacidad, penetración, construcción, impacto, filtrado/clustering) se prueba con `fast-check` (mínimo 100 iteraciones por propiedad); la persistencia PostGIS, el RBAC y el rendimiento se cubren con pruebas de integración, e2e y smoke.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "3.1", "5.1", "6.1", "7.1", "8.1", "9.1", "10.1", "14.1", "15.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.2", "3.3", "5.2", "5.3", "5.4", "6.2", "6.3", "7.2", "7.3", "7.4", "8.2", "9.2", "9.3", "10.2", "10.3", "15.2", "15.3", "15.5"] },
    { "id": 3, "tasks": ["2.5", "2.6", "4.1", "11.1", "12.1", "14.2", "14.6", "15.4", "15.6"] },
    { "id": 4, "tasks": ["4.2", "11.2", "11.3", "12.2", "12.3", "12.4", "12.5", "12.6", "14.3", "14.4"] },
    { "id": 5, "tasks": ["14.5", "17.1"] }
  ]
}
```

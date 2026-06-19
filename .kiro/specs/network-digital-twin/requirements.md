# Requirements Document

## Introduction

Esta funcionalidad evoluciona el módulo de Infraestructura de CICANET desde un mapa con marcadores de NAP, círculos de cobertura y estadísticas hacia un **Gemelo Digital de la Red** FTTH. El modelo actual representa la cobertura como círculos de radio en línea recta (un modelo válido para WiFi o radioenlaces, pero incorrecto para fibra óptica). En FTTH la cobertura real depende del tendido de fibra por las calles, de los puertos libres en cada caja y de las rutas físicas disponibles (postes, cajas, empalmes).

El Gemelo Digital modela la red como **topología y trayectos de fibra**, no como círculos. Se estructura sobre cinco pilares: **Sitios**, **Activos**, **Topología**, **Cobertura** y **Capacidad**. El resto del sistema (clientes, incidencias, monitoreo, expansión, facturación) se conecta a estos pilares.

El alcance cubre: una ficha universal de activos con campos específicos por tipo, el modelo jerárquico de Sitios, la topología y relaciones entre activos, el modelado de fibra como trayectos, la gestión de capacidad con semáforo, cinco vistas del mapa, la ficha lateral de activo, hogares potenciales y penetración por sector, el modo construcción (cálculo de instalable / no instalable y NAP más cercana por ruta), el análisis de impacto por activo y por fibra, evidencia fotográfica y documentos, datos económicos, monitoreo (IP/SNMP) y registro de riesgo. Como requisitos no funcionales se incluyen la persistencia real sobre PostGIS (evolución del actual almacenamiento en memoria/JSON), el control de acceso por rol y el rendimiento del mapa con muchos activos.

## Glossary

- **Gemelo_Digital**: Representación digital de la red física FTTH que modela activos, sus relaciones (topología), los trayectos de fibra, la cobertura y la capacidad como una sola fuente de verdad.
- **Sistema_Infraestructura**: El componente backend (API) y su modelo de datos que registra, calcula y expone los cinco pilares del Gemelo Digital.
- **Mapa_Infraestructura**: El componente frontend (Next.js + MapLibre) que renderiza activos, fibra, cobertura, capacidad y permite la interacción del operador.
- **Sitio**: Entidad superior que agrupa la infraestructura física de una ubicación (ej. POP Popular, POP Santo Domingo). Contiene activos como racks, servidores, UPS, switches, OLTs, cámaras y sensores.
- **Activo**: Cualquier elemento físico registrado de la red (POP, OLT, Splitter, NAP, Empalme, Caja, Fibra, ONU, Switch, Router, UPS, Servidor, Cámara, Cliente).
- **POP**: Point of Presence; nodo principal donde se concentra la infraestructura activa de un sitio.
- **OLT**: Optical Line Terminal; equipo que origina las señales PON de la red FTTH.
- **Splitter**: Divisor óptico que reparte una señal a múltiples puertos.
- **NAP**: Network Access Point; caja de distribución con puertos a los que se conectan los clientes.
- **Empalme**: Punto de fusión de fibras ópticas.
- **ONU**: Optical Network Unit; equipo en el hogar del cliente.
- **Segmento_Fibra**: Trayecto físico de fibra entre dos activos, con longitud y trazado geográfico (LineString).
- **Topología**: Conjunto de relaciones jerárquicas de dependencia entre activos (ej. POP → OLT → Splitter → NAP → Cliente).
- **Capacidad**: Recuento de puertos totales, usados y libres de un activo (típicamente una NAP).
- **Semaforo_Capacidad**: Indicador de estado de capacidad: verde (disponible), amarillo (casi lleno), rojo (saturado).
- **Cobertura**: Área donde el Sistema_Infraestructura puede ofrecer servicio, calculada a partir de topología, capacidad y distancia de tendido, no como círculo de radio recto.
- **Vista_Mapa**: Modo de visualización del Mapa_Infraestructura (Cobertura, Capacidad, Incidencias, Activos, Expansión).
- **Ficha_Activo**: Panel lateral que muestra la información completa de un activo seleccionado.
- **Ficha_Universal**: Conjunto de campos comunes que todo Activo hereda, independiente de su tipo.
- **Modo_Construccion**: Funcionalidad donde el operador marca un punto en el mapa y el Sistema_Infraestructura evalúa la viabilidad de instalación.
- **Analisis_Impacto**: Cálculo de las consecuencias (clientes, NAP, ingresos) de un fallo o intervención sobre un activo o segmento de fibra.
- **Hogares_Potenciales**: Estimación de hogares por sector, con conectados y porcentaje de penetración.
- **Penetracion**: Porcentaje de hogares conectados respecto a los hogares estimados de un sector.
- **Sector**: Subdivisión geográfica comercial (ej. Popular 2) usada para medir hogares potenciales y penetración.
- **Distancia_Tendido**: Distancia de fibra siguiendo calles/rutas entre un punto y una NAP, distinta de la distancia en línea recta.
- **Rol**: Nivel de autorización de un usuario del staff: admin, operador o tecnico.
- **PostGIS**: Extensión geoespacial de PostgreSQL usada para persistir geometrías y ejecutar consultas espaciales.

## Requirements

### Requisito 1: Ficha universal de activos

**Historia de Usuario:** Como operador de la ISP, quiero registrar cada activo de la red con un conjunto común de campos, para tener un inventario completo y consistente de todo el capital desplegado.

#### Criterios de Aceptación

1. WHEN un operador registra un activo, THE Sistema_Infraestructura SHALL almacenar el tipo de activo dentro del conjunto {POP, OLT, Switch, Router, NAP, Splitter, UPS, Servidor, Camara, Fibra, Empalme, ONU, Cliente}.
2. WHEN un operador registra un activo, THE Sistema_Infraestructura SHALL almacenar marca, modelo y número de serie del activo.
3. WHEN un operador registra un activo, THE Sistema_Infraestructura SHALL almacenar dirección, barrio, comuna, ciudad y coordenadas GPS (latitud y longitud).
4. WHEN un operador registra el estado de un activo, THE Sistema_Infraestructura SHALL almacenar el estado dentro del conjunto {Activo, Inactivo, Mantenimiento, Retirado, Dañado}.
5. WHEN un operador registra la propiedad de un activo, THE Sistema_Infraestructura SHALL almacenar si el activo es propio o no, y cuando no es propio SHALL almacenar el régimen dentro del conjunto {Arrendado, Comodato, Tercero}.
6. WHEN un operador guarda un activo, THE Sistema_Infraestructura SHALL almacenar la fecha de instalación y el proveedor del activo.
7. IF un operador intenta guardar un activo sin tipo o sin coordenadas GPS, THEN THE Sistema_Infraestructura SHALL rechazar la operación y devolver un mensaje que indique el campo obligatorio faltante.
8. WHERE un activo expone una interfaz de gestión, THE Sistema_Infraestructura SHALL almacenar dirección IP, puerto y los protocolos de monitoreo disponibles dentro del conjunto {SNMP, API, SSH}.

### Requisito 2: Campos económicos del activo

**Historia de Usuario:** Como administrador de la ISP, quiero registrar los datos económicos de cada activo, para conocer cuánto capital hay desplegado en la red y la cobertura de garantías.

#### Criterios de Aceptación

1. WHEN un operador registra los datos económicos de un activo, THE Sistema_Infraestructura SHALL almacenar costo de compra, costo de instalación, proveedor, fecha de compra y fecha de fin de garantía.
2. WHEN un administrador consulta el capital desplegado, THE Sistema_Infraestructura SHALL calcular la suma de costo de compra más costo de instalación de los activos seleccionados.
3. IF la fecha de fin de garantía de un activo es anterior a la fecha actual, THEN THE Sistema_Infraestructura SHALL marcar el activo con garantía vencida.

### Requisito 3: Evidencia fotográfica y documentos

**Historia de Usuario:** Como técnico de campo, quiero adjuntar fotos y documentos a cada activo, para dejar evidencia verificable de la instalación y la ficha técnica.

#### Criterios de Aceptación

1. WHEN un operador registra un activo, THE Sistema_Infraestructura SHALL permitir adjuntar fotografías clasificadas en las categorías {vista general, frontal, placa serial, instalación}.
2. IF un operador intenta marcar un activo como instalado sin al menos una fotografía adjunta, THEN THE Sistema_Infraestructura SHALL rechazar la operación y devolver un mensaje que indique que la evidencia fotográfica es obligatoria.
3. WHEN un operador adjunta un documento a un activo, THE Sistema_Infraestructura SHALL almacenar el documento asociado al identificador del activo.
4. WHEN un usuario consulta un activo, THE Sistema_Infraestructura SHALL devolver las referencias de las fotografías y documentos asociados al activo.

### Requisito 4: Campos específicos por tipo de activo

**Historia de Usuario:** Como operador de la ISP, quiero registrar los atributos propios de cada tipo de equipo, para tener fichas técnicas completas según la naturaleza de cada activo.

#### Criterios de Aceptación

1. WHERE un activo es de tipo OLT, THE Sistema_Infraestructura SHALL almacenar marca, modelo, cantidad de puertos PON, cantidad de puertos SFP, dirección IP, versión de firmware y capacidad de ONUs.
2. WHERE un activo es de tipo Router, THE Sistema_Infraestructura SHALL almacenar marca, modelo, dirección IP, versión de firmware y proveedor de internet.
3. WHERE un activo es de tipo Switch, THE Sistema_Infraestructura SHALL almacenar cantidad de puertos, cantidad de puertos PoE, velocidad y capacidad de switching.
4. WHERE un activo es de tipo UPS, THE Sistema_Infraestructura SHALL almacenar capacidad en VA, autonomía, cantidad de baterías y fecha del último cambio de batería.
5. WHERE un activo es de tipo Servidor, THE Sistema_Infraestructura SHALL almacenar CPU, memoria RAM, capacidad de disco y sistema operativo.
6. WHERE un activo es de tipo Fibra, THE Sistema_Infraestructura SHALL almacenar el modo dentro del conjunto {monomodo, multimodo}, la cantidad de hilos dentro del conjunto {12, 24, 48, 96, 144}, la longitud, el activo de origen y el activo de destino.
7. WHERE un activo es de tipo Empalme, THE Sistema_Infraestructura SHALL almacenar la cantidad de fibras fusionadas, la fecha de la fusión y el técnico responsable.
8. WHERE un activo es de tipo NAP, THE Sistema_Infraestructura SHALL almacenar código, capacidad de puertos, puertos ocupados, puertos libres, altura de instalación y el tipo de soporte dentro del conjunto {poste, fachada, gabinete}.

### Requisito 5: Registro de riesgo del activo

**Historia de Usuario:** Como administrador de la ISP, quiero registrar la exposición a riesgos de cada activo, para priorizar protección y mantenimiento de la red.

#### Criterios de Aceptación

1. WHEN un operador registra el riesgo de un activo, THE Sistema_Infraestructura SHALL almacenar si el activo está expuesto a robo, si está expuesto a inundación y si cuenta con energía regulada.
2. WHEN un usuario consulta un activo, THE Sistema_Infraestructura SHALL devolver los indicadores de riesgo registrados del activo.

### Requisito 6: Modelo de Sitios

**Historia de Usuario:** Como administrador de la ISP, quiero agrupar la infraestructura física dentro de Sitios, para visualizar todo lo instalado en cada ubicación y no solo la fibra.

#### Criterios de Aceptación

1. WHEN un administrador crea un Sitio, THE Sistema_Infraestructura SHALL almacenar el nombre del Sitio y sus coordenadas GPS.
2. WHEN un operador asocia un activo a un Sitio, THE Sistema_Infraestructura SHALL registrar la pertenencia del activo al Sitio.
3. WHEN un usuario consulta un Sitio, THE Sistema_Infraestructura SHALL devolver la lista de activos asociados al Sitio incluyendo racks, servidores, UPS, switches, OLTs, cámaras y sensores.
4. WHEN el Mapa_Infraestructura solicita los Sitios, THE Sistema_Infraestructura SHALL devolver todos los Sitios con sus coordenadas para su representación en el mapa.

### Requisito 7: Topología y relaciones entre activos

**Historia de Usuario:** Como operador de la ISP, quiero registrar las relaciones de dependencia entre activos, para representar la red como una topología jerárquica y no como puntos aislados.

#### Criterios de Aceptación

1. WHEN un operador define la relación de un activo, THE Sistema_Infraestructura SHALL almacenar el activo padre del que depende.
2. WHEN un usuario consulta la topología de un activo, THE Sistema_Infraestructura SHALL devolver la cadena de dependencia ascendente desde el activo hasta el POP raíz.
3. WHEN un usuario consulta la topología de un activo, THE Sistema_Infraestructura SHALL devolver la lista de activos descendientes que dependen del activo consultado.
4. IF un operador intenta crear una relación que genera un ciclo en la topología, THEN THE Sistema_Infraestructura SHALL rechazar la operación y devolver un mensaje de relación inválida.

### Requisito 8: Modelado de fibra y trayectos

**Historia de Usuario:** Como operador de la ISP, quiero registrar la fibra como trayectos entre activos, para responder qué clientes se pierden si la fibra se corta en un punto determinado.

#### Criterios de Aceptación

1. WHEN un operador registra un Segmento_Fibra, THE Sistema_Infraestructura SHALL almacenar el activo de origen, el activo de destino, la longitud y el trazado geográfico del segmento.
2. WHEN el Mapa_Infraestructura solicita la red de fibra, THE Sistema_Infraestructura SHALL devolver los Segmento_Fibra como geometrías de línea con su trazado.
3. WHEN un usuario consulta un Segmento_Fibra, THE Sistema_Infraestructura SHALL devolver la longitud registrada del segmento.
4. IF un operador intenta registrar un Segmento_Fibra con origen igual al destino, THEN THE Sistema_Infraestructura SHALL rechazar la operación y devolver un mensaje de trayecto inválido.

### Requisito 9: Gestión de capacidad con semáforo

**Historia de Usuario:** Como operador de la ISP, quiero ver la capacidad de cada NAP con un semáforo, para saber de un vistazo dónde puedo instalar nuevos clientes.

#### Criterios de Aceptación

1. WHEN un usuario consulta la capacidad de una NAP, THE Sistema_Infraestructura SHALL calcular los puertos libres como la diferencia entre puertos totales y puertos usados.
2. WHILE los puertos usados de una NAP son menores al 75 por ciento de los puertos totales, THE Sistema_Infraestructura SHALL asignar el estado verde del Semaforo_Capacidad a la NAP.
3. WHILE los puertos usados de una NAP están entre el 75 por ciento inclusive y el 100 por ciento exclusive de los puertos totales, THE Sistema_Infraestructura SHALL asignar el estado amarillo del Semaforo_Capacidad a la NAP.
4. WHILE los puertos usados de una NAP igualan los puertos totales, THE Sistema_Infraestructura SHALL asignar el estado rojo del Semaforo_Capacidad a la NAP.
5. IF un operador intenta registrar puertos usados mayores que los puertos totales de una NAP, THEN THE Sistema_Infraestructura SHALL rechazar la operación y devolver un mensaje de capacidad inválida.

### Requisito 10: Vistas del mapa

**Historia de Usuario:** Como operador de la ISP, quiero cambiar entre distintas vistas del mapa, para analizar la red según la decisión que necesito tomar.

#### Criterios de Aceptación

1. WHEN un usuario selecciona la Vista_Mapa Cobertura, THE Mapa_Infraestructura SHALL representar las áreas donde la ISP puede ofrecer servicio.
2. WHEN un usuario selecciona la Vista_Mapa Capacidad, THE Mapa_Infraestructura SHALL representar las NAP coloreadas según su Semaforo_Capacidad.
3. WHEN un usuario selecciona la Vista_Mapa Incidencias, THE Mapa_Infraestructura SHALL representar los activos cuyo estado indica falla.
4. WHEN un usuario selecciona la Vista_Mapa Activos, THE Mapa_Infraestructura SHALL representar los activos instalados de la red.
5. WHEN un usuario selecciona la Vista_Mapa Expansión, THE Mapa_Infraestructura SHALL representar los sectores donde la penetración es baja respecto a los hogares potenciales.
6. WHEN un usuario cambia de Vista_Mapa, THE Mapa_Infraestructura SHALL conservar la posición y el nivel de zoom actuales del mapa.

### Requisito 11: Ficha lateral de activo

**Historia de Usuario:** Como operador de la ISP, quiero abrir la ficha de un activo al hacer clic en el mapa, para consultar toda su información sin cambiar de pantalla.

#### Criterios de Aceptación

1. WHEN un usuario hace clic en un activo del Mapa_Infraestructura, THE Mapa_Infraestructura SHALL abrir la Ficha_Activo del activo seleccionado.
2. WHEN se abre la Ficha_Activo, THE Mapa_Infraestructura SHALL mostrar la sección Información General con ubicación, fotos, modelo, serial, proveedor y garantía.
3. WHEN se abre la Ficha_Activo de una NAP, THE Mapa_Infraestructura SHALL mostrar la sección Topología con la cadena POP, OLT, Splitter y NAP.
4. WHEN se abre la Ficha_Activo de una NAP, THE Mapa_Infraestructura SHALL mostrar la sección Capacidad con puertos usados y puertos libres.
5. WHEN se abre la Ficha_Activo de una NAP, THE Mapa_Infraestructura SHALL mostrar la lista de clientes asociados al activo.
6. WHEN se abre la Ficha_Activo, THE Mapa_Infraestructura SHALL mostrar la sección Historial con los eventos de instalación, mantenimiento, cambio de puerto e incidencia del activo.

### Requisito 12: Hogares potenciales y penetración

**Historia de Usuario:** Como administrador comercial, quiero ver los hogares potenciales y la penetración por sector, para identificar dónde hay oportunidad de crecimiento.

#### Criterios de Aceptación

1. WHEN un administrador registra un Sector, THE Sistema_Infraestructura SHALL almacenar el nombre del Sector y la cantidad de hogares estimados.
2. WHEN un usuario consulta un Sector, THE Sistema_Infraestructura SHALL calcular la cantidad de hogares conectados del Sector a partir de los clientes activos asociados.
3. WHEN un usuario consulta un Sector, THE Sistema_Infraestructura SHALL calcular la Penetracion como el porcentaje de hogares conectados respecto a los hogares estimados del Sector.
4. IF los hogares estimados de un Sector son cero, THEN THE Sistema_Infraestructura SHALL reportar la Penetracion como no disponible.

### Requisito 13: Modo construcción

**Historia de Usuario:** Como operador de la ISP, quiero marcar en el mapa el punto donde un cliente solicita servicio, para saber al instante si es instalable y a qué costo.

#### Criterios de Aceptación

1. WHEN un operador marca un punto en Modo_Construccion, THE Sistema_Infraestructura SHALL identificar la NAP más cercana según la Distancia_Tendido por rutas.
2. WHEN el Sistema_Infraestructura identifica la NAP más cercana en Modo_Construccion, THE Sistema_Infraestructura SHALL devolver la Distancia_Tendido, los puertos libres de la NAP, el costo estimado y el tiempo de instalación estimado.
3. WHILE la NAP más cercana tiene al menos un puerto libre y la Distancia_Tendido es menor o igual a la distancia máxima de instalación permitida de la NAP, THE Sistema_Infraestructura SHALL reportar el resultado como Instalable.
4. IF la NAP más cercana no tiene puertos libres o la Distancia_Tendido supera la distancia máxima de instalación permitida, THEN THE Sistema_Infraestructura SHALL reportar el resultado como No instalable e indicar la causa.
5. WHEN un operador define la cobertura comercial de una NAP, THE Sistema_Infraestructura SHALL almacenar la distancia máxima de instalación permitida de la NAP y las calles o el polígono donde puede vender.

### Requisito 14: Análisis de impacto por activo y fibra

**Historia de Usuario:** Como administrador de la ISP, quiero ver el impacto de un fallo al seleccionar un activo o una fibra troncal, para convertir el mapa en una herramienta de decisión.

#### Criterios de Aceptación

1. WHEN un usuario selecciona un activo para Analisis_Impacto, THE Sistema_Infraestructura SHALL calcular la cantidad de clientes dependientes del activo recorriendo la topología descendente.
2. WHEN un usuario selecciona un Segmento_Fibra para Analisis_Impacto, THE Sistema_Infraestructura SHALL devolver la longitud del segmento, la cantidad de clientes dependientes, la cantidad de NAP dependientes y los ingresos mensuales asociados.
3. WHEN el Sistema_Infraestructura calcula los ingresos mensuales asociados a un activo o segmento, THE Sistema_Infraestructura SHALL sumar el precio mensual de los planes de los clientes dependientes.
4. WHEN un usuario consulta el impacto de cualquier activo, THE Sistema_Infraestructura SHALL calcular automáticamente la cantidad de clientes dependientes sin requerir captura manual de ese valor.

### Requisito 15: Persistencia sobre PostGIS

**Historia de Usuario:** Como administrador del sistema, quiero que el Gemelo Digital se almacene en una base de datos geoespacial real, para garantizar durabilidad, consultas espaciales y crecimiento del inventario.

#### Criterios de Aceptación

1. THE Sistema_Infraestructura SHALL persistir los activos, sitios, segmentos de fibra, áreas de cobertura y sectores en PostGIS.
2. WHEN el Sistema_Infraestructura almacena la ubicación de un activo o sitio, THE Sistema_Infraestructura SHALL guardar la geometría como punto en el sistema de referencia espacial 4326.
3. WHEN el Sistema_Infraestructura almacena un Segmento_Fibra, THE Sistema_Infraestructura SHALL guardar el trazado como geometría de línea en el sistema de referencia espacial 4326.
4. WHEN el Sistema_Infraestructura almacena un área de cobertura o el polígono comercial de una NAP, THE Sistema_Infraestructura SHALL guardar la geometría como polígono en el sistema de referencia espacial 4326.
5. WHEN el Sistema_Infraestructura responde una consulta de contención espacial de un punto en un polígono, THE Sistema_Infraestructura SHALL resolver la consulta mediante operaciones espaciales de PostGIS.

### Requisito 16: Control de acceso por rol

**Historia de Usuario:** Como administrador de la ISP, quiero controlar quién puede modificar la infraestructura según su rol, para proteger la integridad del inventario.

#### Criterios de Aceptación

1. IF una petición a un endpoint de infraestructura no presenta una sesión autenticada válida, THEN THE Sistema_Infraestructura SHALL rechazar la petición con un error de autenticación.
2. WHERE un endpoint crea, modifica o elimina activos, sitios, fibra o sectores, THE Sistema_Infraestructura SHALL autorizar la operación únicamente a usuarios con Rol admin u operador.
3. WHEN un usuario con Rol tecnico registra evidencia fotográfica o eventos de mantenimiento de un activo, THE Sistema_Infraestructura SHALL autorizar la operación.
4. IF un usuario con Rol tecnico intenta eliminar un activo, sitio, fibra o sector, THEN THE Sistema_Infraestructura SHALL rechazar la operación con un error de autorización.
5. WHEN cualquier usuario autenticado consulta el Mapa_Infraestructura y las fichas de activos, THE Sistema_Infraestructura SHALL autorizar la lectura.

### Requisito 17: Rendimiento del mapa con muchos activos

**Historia de Usuario:** Como operador de la ISP, quiero que el mapa siga siendo fluido aunque haya miles de activos, para trabajar sin esperas.

#### Criterios de Aceptación

1. WHEN el Mapa_Infraestructura solicita los activos visibles, THE Sistema_Infraestructura SHALL devolver únicamente los activos contenidos en el área visible del mapa solicitada.
2. WHEN el área visible contiene más de 1000 activos, THE Sistema_Infraestructura SHALL devolver representaciones agrupadas en lugar de activos individuales.
3. WHEN el Mapa_Infraestructura solicita los datos de una Vista_Mapa para un área visible, THE Sistema_Infraestructura SHALL responder en 2 segundos o menos para un inventario de hasta 10000 activos.

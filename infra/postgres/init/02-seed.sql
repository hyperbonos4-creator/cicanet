-- ============================================================
--  URBAN · Seed PostGIS — Popular 2 (Comuna 1, Medellín)
--  Mismos datos que sirve la API en la demo, para producción.
-- ============================================================

-- ---- Nodos ----
INSERT INTO nodos_red (codigo, nombre, tipo, ubicacion, capacidad_total, capacidad_usada, estado) VALUES
 ('POP-01','POP-01 · Nodo principal','POP', ST_SetSRID(ST_Point(-75.5491,6.2973),4326), 256, 247, 'online'),
 ('NAP-01','NAP-01','NAP', ST_SetSRID(ST_Point(-75.5501,6.2978),4326), 16, 11, 'online'),
 ('NAP-02','NAP-02','NAP', ST_SetSRID(ST_Point(-75.5484,6.2966),4326), 16, 8,  'online'),
 ('NAP-03','NAP-03','NAP', ST_SetSRID(ST_Point(-75.5468,6.2974),4326), 16, 15, 'online'),
 ('NAP-04','NAP-04','NAP', ST_SetSRID(ST_Point(-75.5460,6.2964),4326), 16, 16, 'degradado'),
 ('CTO-05','CTO-05','CTO', ST_SetSRID(ST_Point(-75.5497,6.2962),4326), 8,  5,  'online')
ON CONFLICT (codigo) DO NOTHING;

-- ---- Áreas de cobertura ----
INSERT INTO areas_cobertura (nombre, poligono, tecnologia, estado) VALUES
 ('Popular 2 · Núcleo FTTH',
  ST_GeomFromText('POLYGON((-75.5512 6.2985,-75.5478 6.2986,-75.5476 6.2958,-75.5510 6.2957,-75.5512 6.2985))',4326),
  'FTTH','cobertura'),
 ('Popular 2 · Cobertura parcial',
  ST_GeomFromText('POLYGON((-75.5478 6.2986,-75.5450 6.2987,-75.5449 6.2960,-75.5476 6.2958,-75.5478 6.2986))',4326),
  'FTTH','parcial'),
 ('Popular 2 · Sin cobertura (planeado Q3)',
  ST_GeomFromText('POLYGON((-75.5510 6.2957,-75.5476 6.2958,-75.5474 6.2940,-75.5508 6.2939,-75.5510 6.2957))',4326),
  'FTTH','sin_cobertura');

-- ---- Fibra troncal (POP → NAPs) ----
INSERT INTO segmentos_fibra (codigo, origen_id, destino_id, trazado)
SELECT 'FIB-01', p.id, n.id, ST_GeomFromText('LINESTRING(-75.5491 6.2973,-75.5501 6.2978)',4326)
FROM nodos_red p, nodos_red n WHERE p.codigo='POP-01' AND n.codigo='NAP-01';
INSERT INTO segmentos_fibra (codigo, origen_id, destino_id, trazado)
SELECT 'FIB-02', p.id, n.id, ST_GeomFromText('LINESTRING(-75.5491 6.2973,-75.5484 6.2966)',4326)
FROM nodos_red p, nodos_red n WHERE p.codigo='POP-01' AND n.codigo='NAP-02';
INSERT INTO segmentos_fibra (codigo, origen_id, destino_id, trazado)
SELECT 'FIB-03', p.id, n.id, ST_GeomFromText('LINESTRING(-75.5491 6.2973,-75.5480 6.2970,-75.5468 6.2974)',4326)
FROM nodos_red p, nodos_red n WHERE p.codigo='POP-01' AND n.codigo='NAP-03';
INSERT INTO segmentos_fibra (codigo, origen_id, destino_id, trazado)
SELECT 'FIB-05', p.id, n.id, ST_GeomFromText('LINESTRING(-75.5491 6.2973,-75.5497 6.2962)',4326)
FROM nodos_red p, nodos_red n WHERE p.codigo='POP-01' AND n.codigo='CTO-05';

-- ---- Clientes muestra ----
INSERT INTO clientes (codigo, nombre, ubicacion, estado) VALUES
 ('CL-1001','Cliente 1001', ST_SetSRID(ST_Point(-75.5505,6.2981),4326),'activo'),
 ('CL-1004','Cliente 1004', ST_SetSRID(ST_Point(-75.5489,6.2979),4326),'suspendido'),
 ('CL-1008','Cliente 1008', ST_SetSRID(ST_Point(-75.5472,6.2969),4326),'suspendido'),
 ('CL-1010','Cliente 1010', ST_SetSRID(ST_Point(-75.5463,6.2961),4326),'activo')
ON CONFLICT (codigo) DO NOTHING;

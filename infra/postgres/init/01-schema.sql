-- ============================================================
--  URBAN · Esquema PostGIS — Fase 1 (red + cobertura)
--  Se ejecuta automáticamente al inicializar el contenedor postgis.
--  El resto de tablas (clientes/facturación) se añaden en Fase 2.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- Tipos enumerados ----
DO $$ BEGIN
  CREATE TYPE tipo_nodo AS ENUM ('POP','OLT','NAP','CTO','SPLITTER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_nodo AS ENUM ('online','offline','degradado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tecnologia AS ENUM ('FTTH','HFC','Wireless');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_cobertura AS ENUM ('cobertura','parcial','sin_cobertura');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_cliente AS ENUM ('activo','suspendido','retirado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Nodos de red ----
CREATE TABLE IF NOT EXISTS nodos_red (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo          text UNIQUE NOT NULL,
  nombre          text NOT NULL,
  tipo            tipo_nodo NOT NULL,
  ubicacion       geometry(Point,4326) NOT NULL,
  capacidad_total int NOT NULL DEFAULT 0,
  capacidad_usada int NOT NULL DEFAULT 0,
  estado          estado_nodo NOT NULL DEFAULT 'online',
  padre_id        uuid REFERENCES nodos_red(id),
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nodos_geo ON nodos_red USING GIST (ubicacion);

-- ---- Áreas de cobertura ----
CREATE TABLE IF NOT EXISTS areas_cobertura (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      text NOT NULL,
  poligono    geometry(Polygon,4326) NOT NULL,
  tecnologia  tecnologia NOT NULL DEFAULT 'FTTH',
  estado      estado_cobertura NOT NULL DEFAULT 'cobertura'
);
CREATE INDEX IF NOT EXISTS idx_cobertura_geo ON areas_cobertura USING GIST (poligono);

-- ---- Segmentos de fibra ----
CREATE TABLE IF NOT EXISTS segmentos_fibra (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo     text UNIQUE,
  origen_id  uuid REFERENCES nodos_red(id),
  destino_id uuid REFERENCES nodos_red(id),
  trazado    geometry(LineString,4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fibra_geo ON segmentos_fibra USING GIST (trazado);

-- ---- Clientes (georreferenciados) ----
CREATE TABLE IF NOT EXISTS clientes (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo     text UNIQUE NOT NULL,
  documento  text,
  nombre     text,
  direccion  text,
  ubicacion  geometry(Point,4326),
  estado     estado_cliente NOT NULL DEFAULT 'activo',
  nodo_id    uuid REFERENCES nodos_red(id),
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clientes_geo ON clientes USING GIST (ubicacion);

-- ---- Vista para Martin (tiles vectoriales) ----
-- Martin publica automáticamente tablas con columna geométrica.
-- Consulta clave: ¿una dirección tiene cobertura?
--   SELECT estado, tecnologia FROM areas_cobertura
--   WHERE ST_Contains(poligono, ST_SetSRID(ST_Point(:lng,:lat),4326))
--   ORDER BY estado LIMIT 1;

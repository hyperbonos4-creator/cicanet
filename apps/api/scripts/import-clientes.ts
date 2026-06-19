/**
 * Importa los suscriptores del antiguo `data/clientes.json` (modelo plano)
 * a las tablas normalizadas cliente + punto_instalacion + servicio.
 *
 * - Idempotente: si el `documento` ya existe en la BD, se omite.
 * - Si no hay `clientes.json`, no hace nada (no es un error).
 *
 * Uso (dentro del contenedor):  npm run import:clientes
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();

async function main() {
  const file = resolve(process.cwd(), 'data', 'clientes.json');
  if (!existsSync(file)) {
    console.log(`[import] No existe ${file} — nada que importar.`);
    return;
  }

  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const clientes: any[] = Array.isArray(raw) ? raw : [];
  console.log(`[import] ${clientes.length} registros en clientes.json`);

  let creados = 0;
  let omitidos = 0;

  for (const c of clientes) {
    const documento = String(c.documento || '').trim();
    if (!documento) {
      omitidos++;
      continue;
    }
    const existe = await prisma.cliente.findUnique({ where: { documento } });
    if (existe) {
      omitidos++;
      continue;
    }

    const date = (v?: string) => (v ? new Date(v) : null);

    await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({
        data: {
          codigo: c.id || `CLI-${String(creados + 1).padStart(4, '0')}`,
          tipoDocumento: c.tipoDocumento ?? 'CC',
          documento,
          nombre: c.nombre ?? 'Sin nombre',
          tipoCliente: c.tipoCliente ?? 'residencial',
          email: c.email ?? null,
          telefonoMovil: c.telefonoMovil ?? null,
          telefonoFijo: c.telefonoFijo ?? null,
          estado: c.estado ?? 'activo',
          notas: c.notas ?? null,
          creadoPor: c.creadoPor ?? 'import',
          creadoEn: date(c.creadoEn) ?? new Date(),
        },
      });
      const punto = await tx.puntoInstalacion.create({
        data: {
          clienteId: cliente.id,
          direccion: c.direccion ?? 'N/D',
          barrio: c.barrio ?? null,
          comuna: c.comuna ?? null,
          ciudad: c.ciudad ?? 'Medellín',
          departamento: c.departamento ?? null,
          estrato: c.estrato ?? null,
          lat: c.lat ?? null,
          lng: c.lng ?? null,
          referencias: c.referencias ?? null,
        },
      });
      await tx.servicio.create({
        data: {
          clienteId: cliente.id,
          puntoId: punto.id,
          planNombre: c.plan ?? 'Sin plan',
          velocidadBajada: c.velocidadBajada ?? null,
          velocidadSubida: c.velocidadSubida ?? null,
          tecnologia: c.tecnologia ?? 'FTTH',
          napId: c.napId ?? null,
          puerto: c.puerto ?? null,
          onuSerial: c.onuSerial ?? null,
          ip: c.ip ?? null,
          vlan: c.vlan ?? null,
          fechaInstalacion: date(c.fechaInstalacion),
          estado: c.estadoServicio ?? 'instalacion_pendiente',
          cicloFacturacion: c.cicloFacturacion ?? null,
          diaCorte: c.diaCorte ?? null,
          metodoPago: c.metodoPago ?? null,
          tarifa: c.tarifa ?? null,
          saldo: c.saldo ?? null,
          numeroContrato: c.numeroContrato ?? null,
          fechaInicioContrato: date(c.fechaInicioContrato),
          fechaFinContrato: date(c.fechaFinContrato),
        },
      });
    });
    creados++;
  }

  const total = await prisma.cliente.count();
  console.log(`[import] Creados: ${creados} · Omitidos: ${omitidos} · Total en BD: ${total}`);
}

main()
  .catch((e) => {
    console.error('[import] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

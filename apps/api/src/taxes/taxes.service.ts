import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = (n: Prisma.Decimal | number | null | undefined) => Number(n ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reglas de impuestos por defecto (Colombia). Valores aproximados 2026 — la
 * contadora los ajusta cada año (las bases dependen de la UVT). Editable desde
 * el panel; aquí solo se siembran si la tabla está vacía.
 */
const SEED = [
  { codigo: 'iva_19', tipo: 'iva', nombre: 'IVA general 19%', porcentaje: 19, baseMinima: 0, cuentaPuc: '240805' },
  { codigo: 'iva_5', tipo: 'iva', nombre: 'IVA reducido 5%', porcentaje: 5, baseMinima: 0, cuentaPuc: '240805' },
  { codigo: 'rf_compras', tipo: 'retefuente', nombre: 'Retefuente compras generales 2.5%', porcentaje: 2.5, baseMinima: 1300000, cuentaPuc: '236540' },
  { codigo: 'rf_servicios', tipo: 'retefuente', nombre: 'Retefuente servicios generales 4%', porcentaje: 4, baseMinima: 150000, cuentaPuc: '236570' },
  { codigo: 'rf_servicios6', tipo: 'retefuente', nombre: 'Retefuente servicios (no declarante) 6%', porcentaje: 6, baseMinima: 150000, cuentaPuc: '236570' },
  { codigo: 'rf_honorarios', tipo: 'retefuente', nombre: 'Retefuente honorarios 11%', porcentaje: 11, baseMinima: 0, cuentaPuc: '236505' },
  { codigo: 'reteiva_15', tipo: 'reteiva', nombre: 'ReteIVA 15% del IVA', porcentaje: 15, baseMinima: 0, cuentaPuc: '236701' },
  { codigo: 'reteica_966', tipo: 'reteica', nombre: 'ReteICA 9.66 x mil (servicios)', porcentaje: 9.66, baseMinima: 0, cuentaPuc: '236801' },
];

export interface CalculoInput {
  base: number;
  ivaCodigo?: string;        // iva_19 | iva_5 | (none)
  ivaMonto?: number;         // IVA ya calculado (override para reteIVA, si no se usa ivaCodigo)
  retefuenteCodigo?: string; // rf_compras | rf_servicios | ...
  aplicarReteIva?: boolean;
  reteIcaCodigo?: string;    // reteica_966 | ...
}

/**
 * Motor de impuestos: calcula IVA y retenciones según reglas parametrizables,
 * respetando bases mínimas. Devuelve montos listos para la causación.
 */
@Injectable()
export class TaxesService implements OnModuleInit {
  private readonly logger = new Logger('TaxesService');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const n = await this.prisma.reglaImpuesto.count();
    if (n === 0) {
      await this.prisma.reglaImpuesto.createMany({ data: SEED });
      this.logger.log(`Reglas de impuesto sembradas: ${SEED.length}`);
    }
  }

  list(tipo?: string) {
    return this.prisma.reglaImpuesto.findMany({ where: { tipo, activa: undefined }, orderBy: [{ tipo: 'asc' }, { porcentaje: 'desc' }] });
  }

  async upsert(input: { codigo: string; tipo: string; nombre: string; porcentaje: number; baseMinima?: number; cuentaPuc: string; activa?: boolean }) {
    return this.prisma.reglaImpuesto.upsert({
      where: { codigo: input.codigo },
      update: { tipo: input.tipo, nombre: input.nombre, porcentaje: input.porcentaje, baseMinima: input.baseMinima ?? 0, cuentaPuc: input.cuentaPuc, activa: input.activa ?? true },
      create: { codigo: input.codigo, tipo: input.tipo, nombre: input.nombre, porcentaje: input.porcentaje, baseMinima: input.baseMinima ?? 0, cuentaPuc: input.cuentaPuc, activa: input.activa ?? true },
    });
  }

  /** Calcula IVA + retenciones para una base y reglas dadas. */
  async calcular(input: CalculoInput) {
    const base = round2(D(input.base));
    const reglas = await this.prisma.reglaImpuesto.findMany({ where: { activa: true } });
    const byId = new Map(reglas.map((r) => [r.codigo, r]));

    const iva = input.ivaCodigo && byId.has(input.ivaCodigo) ? round2(base * D(byId.get(input.ivaCodigo)!.porcentaje) / 100) : 0;
    const ivaParaRete = input.ivaMonto != null ? round2(D(input.ivaMonto)) : iva;

    let retefuente = 0;
    if (input.retefuenteCodigo && byId.has(input.retefuenteCodigo)) {
      const r = byId.get(input.retefuenteCodigo)!;
      if (base >= D(r.baseMinima)) retefuente = round2(base * D(r.porcentaje) / 100);
    }

    let reteIva = 0;
    if (input.aplicarReteIva && ivaParaRete > 0) {
      const r = byId.get('reteiva_15');
      if (r) reteIva = round2(ivaParaRete * D(r.porcentaje) / 100);
    }

    let reteIca = 0;
    if (input.reteIcaCodigo && byId.has(input.reteIcaCodigo)) {
      const r = byId.get(input.reteIcaCodigo)!;
      if (base >= D(r.baseMinima)) reteIca = round2(base * D(r.porcentaje) / 1000); // por mil
    }

    return {
      base,
      iva,
      retefuente,
      reteIva,
      reteIca,
      totalImpuestos: round2(iva - retefuente - reteIva - reteIca),
      netoAPagar: round2(base + iva - retefuente - reteIva - reteIca),
    };
  }
}

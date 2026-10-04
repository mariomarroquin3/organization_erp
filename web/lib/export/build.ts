import type { Db } from '@/lib/supabase/server';
import { goalCompliance, monthlySummary, personsOverview, reportMatrix, serviceYearSummary } from '@/lib/services/metrics';
import { listMovements } from '@/lib/services/movements';
import {
  REPORT_KEYS, complianceTable, completenessTable, matrixTable, monthlyTable, movementsTable, personsTable,
  type ReportKey, type ReportTable,
} from './tables';
import { annualOverview, annualSummaryTable, groupTotalsTable, type AnnualOverview } from './annual';

export async function buildTable(db: Db, key: ReportKey, sy: number): Promise<ReportTable> {
  switch (key) {
    case 'cumplimiento': return complianceTable(await goalCompliance(db, sy), sy);
    case 'completitud': return completenessTable(await serviceYearSummary(db, sy), sy);
    case 'matriz': return matrixTable(await reportMatrix(db, sy), sy);
    case 'mensual': return monthlyTable(await monthlySummary(db, sy), sy);
    case 'personas': return personsTable(await personsOverview(db));
    case 'movimientos': return movementsTable(await listMovements(db, { serviceYear: sy }), sy);
  }
}

/** 'todo' arma un solo archivo con todos los informes. */
export async function buildTables(db: Db, key: ReportKey | 'todo', sy: number) {
  const keys = key === 'todo' ? REPORT_KEYS : [key];
  return Promise.all(keys.map((k) => buildTable(db, k, sy)));
}

export async function loadAnnualOverview(db: Db, sy: number): Promise<AnnualOverview> {
  const [compliance, monthly, movements] = await Promise.all([
    goalCompliance(db, sy), monthlySummary(db, sy), listMovements(db, { serviceYear: sy }),
  ]);
  return annualOverview(sy, { compliance, monthly, movements });
}

/** Informe del año de servicio: resumen, cumplimiento, grupos y detalle. */
export async function buildAnnual(db: Db, sy: number): Promise<ReportTable[]> {
  const [overview, compliance, completeness, matrix, movements] = await Promise.all([
    loadAnnualOverview(db, sy),
    buildTable(db, 'cumplimiento', sy),
    buildTable(db, 'completitud', sy),
    buildTable(db, 'matriz', sy),
    buildTable(db, 'movimientos', sy),
  ]);
  return [annualSummaryTable(overview), compliance, groupTotalsTable(overview), matrix, completeness, movements];
}

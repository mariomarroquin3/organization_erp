// Convierte los datos de las métricas en tablas neutrales que luego se
// escriben a Excel (xlsx.ts) o PDF (pdf.ts). Funciones puras, probadas
// en tests/export.test.ts.
import type { GoalCompliance, MonthlySummary, PersonMovement, PersonOverview, ReportMatrixRow, ServiceYearSummary } from '@/lib/types';
import { MONTH_SHORT, serviceYearLabel, serviceYearMonths } from '@/lib/service-year';
import { STATUS_LABEL, fmtDate } from '@/lib/format';

export type CellFormat = 'text' | 'num' | 'pct';
export type Cell = string | number | null;

export interface Column { header: string; format?: CellFormat; width?: number }

export interface ReportTable {
  key: string;        // nombre corto (hoja de Excel)
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Cell[][];
  landscape?: boolean;
  notes?: string[];
}

export const REPORTS = {
  cumplimiento: 'Cumplimiento de metas PR/PA',
  completitud: 'Completitud de informes por persona',
  matriz: 'Informes mes a mes',
  mensual: 'Resumen mensual por grupo',
  personas: 'Directorio de personas',
  movimientos: 'Altas, bajas y traslados',
} as const;
export type ReportKey = keyof typeof REPORTS;
export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];

const n = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export function complianceTable(rows: GoalCompliance[], sy: number): ReportTable {
  return {
    key: 'Cumplimiento',
    title: REPORTS.cumplimiento,
    subtitle: `Año de servicio ${serviceYearLabel(sy)}`,
    landscape: true,
    columns: [
      { header: 'Apellidos', width: 18 }, { header: 'Nombre', width: 16 }, { header: 'Cargo', width: 7 },
      { header: 'Meses con cargo', format: 'num' }, { header: 'Meses cerrados', format: 'num' },
      { header: 'Informes faltantes', format: 'num' },
      { header: 'Meta del año (h)', format: 'num' }, { header: 'Meta a la fecha (h)', format: 'num' },
      { header: 'Horas', format: 'num' }, { header: 'Faltan (h)', format: 'num' },
      { header: '% meta', format: 'pct' }, { header: '% a la fecha', format: 'pct' },
      { header: 'h/mes necesarias', format: 'num' }, { header: 'Estado', width: 12 },
    ],
    rows: rows.map((r) => [
      r.last_name, r.first_name, r.role_code,
      r.months_in_role, r.months_closed, r.months_missing,
      n(r.goal_hours), n(r.goal_to_date), n(r.hours_done), n(r.hours_remaining),
      n(r.pct_goal), n(r.pct_to_date), n(r.hours_needed_per_month), STATUS_LABEL[r.status] ?? r.status,
    ]),
    notes: [
      'La meta anual de PR se prorratea por los meses con el cargo; la de PA es por mes con el cargo.',
      '"A la fecha" considera solo meses cerrados (anteriores al mes en curso).',
    ],
  };
}

export function completenessTable(rows: ServiceYearSummary[], sy: number): ReportTable {
  return {
    key: 'Completitud',
    title: REPORTS.completitud,
    subtitle: `Año de servicio ${serviceYearLabel(sy)} · meses cerrados`,
    landscape: true,
    columns: [
      { header: 'Apellidos', width: 18 }, { header: 'Nombre', width: 16 }, { header: 'Grupo', width: 14 },
      { header: 'Cargos actuales', width: 14 },
      { header: 'Meses esperados', format: 'num' }, { header: 'Meses informados', format: 'num' },
      { header: 'Meses con participación', format: 'num' },
      { header: '% informado', format: 'pct' }, { header: '% participación', format: 'pct' },
      { header: 'Horas', format: 'num' },
    ],
    rows: rows.map((r) => [
      r.last_name, r.first_name, r.group_name, r.current_roles ?? 'Sin cargo',
      r.months_expected, r.months_reported, r.months_participated,
      n(r.pct_reported), n(r.pct_participated), n(r.total_hours),
    ]),
    notes: ['Para quien no es PR ni PA, la participación es sí/no por mes.'],
  };
}

/**
 * Celda de la matriz: horas para PR/PA, Sí/No para el resto, vacío si no
 * informó. Si informó cursos bíblicos se agregan como "· 2 c.".
 */
export function matrixCell(
  r: Pick<ReportMatrixRow, 'has_report' | 'participated' | 'hours' | 'hours_role'> & { bible_studies?: number | null },
): Cell {
  if (!r.has_report) return r.hours_role ? 'Falta' : '—';
  const base = r.hours_role || (r.hours !== null && Number(r.hours) > 0) ? Number(r.hours ?? 0) : r.participated ? 'Sí' : 'No';
  const studies = Number(r.bible_studies ?? 0);
  return studies > 0 ? `${base} · ${studies} c.` : base;
}

export function matrixTable(rows: ReportMatrixRow[], sy: number): ReportTable {
  const months = serviceYearMonths(sy);
  const keyOf = (y: number, m: number) => y * 100 + m;
  const people = new Map<string, {
    last: string; first: string; group: string | null; roles: Set<string>; cells: Map<number, Cell>; hours: number; studies: number;
  }>();
  for (const r of rows) {
    const p = people.get(r.person_id) ?? { last: r.last_name, first: r.first_name, group: null, roles: new Set<string>(), cells: new Map(), hours: 0, studies: 0 };
    p.group = r.group_name ?? p.group; // grupo del último mes con dato
    if (r.hours_role) p.roles.add(r.hours_role);
    p.cells.set(keyOf(r.year, r.month), matrixCell(r));
    p.hours += Number(r.hours ?? 0);
    p.studies = Math.max(p.studies, Number(r.bible_studies ?? 0));
    people.set(r.person_id, p);
  }
  return {
    key: 'Mes a mes',
    title: REPORTS.matriz,
    subtitle: `Año de servicio ${serviceYearLabel(sy)} · horas (PR/PA) o participación sí/no`,
    landscape: true,
    columns: [
      { header: 'Apellidos', width: 16 }, { header: 'Nombre', width: 14 }, { header: 'Grupo', width: 12 },
      { header: 'PR/PA', width: 7 },
      ...months.map((m) => ({ header: `${MONTH_SHORT[m.month - 1]} ${String(m.year).slice(2)}`, width: 7 })),
      { header: 'Total h', format: 'num' as const },
      { header: 'Cursos (máx./mes)', format: 'num' as const },
    ],
    rows: [...people.values()].map((p) => [
      p.last, p.first, p.group, [...p.roles].sort().join('/') || null,
      ...months.map((m) => p.cells.get(keyOf(m.year, m.month)) ?? null),
      p.hours,
      p.studies,
    ]),
    notes: [
      '"Falta": era PR/PA ese mes y no hay informe. "—": no informó. "· 2 c.": cursos bíblicos informados ese mes.',
      'Celda vacía: el mes aún no cierra o la persona no era miembro ese mes (antes de su alta o después de su baja).',
    ],
  };
}

export function monthlyTable(rows: MonthlySummary[], sy: number): ReportTable {
  return {
    key: 'Resumen mensual',
    title: REPORTS.mensual,
    subtitle: `Año de servicio ${serviceYearLabel(sy)}`,
    columns: [
      { header: 'Mes', width: 10 }, { header: 'Grupo', width: 16 },
      { header: 'Personas', format: 'num' }, { header: 'Informes', format: 'num' },
      { header: 'Participaron', format: 'num' }, { header: '% informado', format: 'pct' },
      { header: 'PR/PA', format: 'num' }, { header: 'Horas', format: 'num' },
      { header: 'Cursos bíblicos', format: 'num' },
    ],
    rows: rows.map((r) => {
      const [y, m] = r.period.split('-').map(Number);
      return [
        `${MONTH_SHORT[m - 1]} ${y}`, r.group_name ?? 'Sin grupo', r.persons, r.reports_received,
        r.participated, n(r.pct_reported), r.hours_role_persons, n(r.total_hours),
        Number(r.bible_studies ?? 0),
      ];
    }),
  };
}

export function personsTable(rows: PersonOverview[]): ReportTable {
  return {
    key: 'Personas',
    title: REPORTS.personas,
    subtitle: 'Estado actual',
    columns: [
      { header: 'Apellidos', width: 18 }, { header: 'Nombre', width: 16 }, { header: 'Grupo', width: 14 },
      { header: 'Cargos', width: 14 }, { header: 'Nacimiento', width: 12 }, { header: 'Activo', width: 8 },
      { header: 'Última alta/baja', width: 24 },
    ],
    rows: rows.map((r) => [
      r.last_name, r.first_name, r.group_name, r.current_roles, r.birth_date ? fmtDate(r.birth_date) : null,
      r.is_active ? 'Sí' : 'No',
      r.last_movement_date ? `${fmtDate(r.last_movement_date)} · ${r.last_movement_type}` : null,
    ]),
  };
}

export function movementsTable(rows: PersonMovement[], sy: number): ReportTable {
  const sorted = [...rows].sort((a, b) => a.movement_date.localeCompare(b.movement_date));
  const altas = rows.filter((r) => r.direction === 'ALTA').length;
  return {
    key: 'Altas y bajas',
    title: REPORTS.movimientos,
    subtitle: `Año de servicio ${serviceYearLabel(sy)} · ${altas} alta(s), ${rows.length - altas} baja(s)`,
    columns: [
      { header: 'Fecha', width: 12 }, { header: 'Apellidos', width: 18 }, { header: 'Nombre', width: 16 },
      { header: 'Alta/Baja', width: 9 }, { header: 'Motivo', width: 28 }, { header: 'Congregación', width: 22 },
      { header: 'Notas', width: 28 },
    ],
    rows: sorted.map((r) => [
      fmtDate(r.movement_date), r.last_name, r.first_name, r.direction === 'ALTA' ? 'Alta' : 'Baja',
      r.type_name, r.congregation, r.notes,
    ]),
    notes: ['Congregación: de origen en las altas por traslado, de destino en las bajas por traslado.'],
  };
}

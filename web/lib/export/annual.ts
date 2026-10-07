// Informe del año de servicio: un resumen de cierre (o de avance, si el
// año aún no termina) más las tablas de detalle. Funciones puras,
// probadas en tests/annual.test.ts.
import type { GoalCompliance, MonthlySummary, PersonMovement } from '@/lib/types';
import { fmtNum, fmtPct } from '@/lib/format';
import { serviceYearLabel, serviceYearMonths } from '@/lib/service-year';
import type { Cell, ReportTable } from './tables';

export interface RoleTotals {
  persons: number;
  hours: number;
  goal: number;
  pct: number | null;
  met: number;        // CUMPLIDA
  notMet: number;     // NO CUMPLIDA
  onTrack: number;    // AL DIA
  behind: number;     // ATRASADO
}

export interface GroupTotals {
  group: string;
  expected: number;   // meses-persona esperados
  received: number;
  participated: number;
  pct: number | null;
  hours: number;
  studies: number;    // suma de cursos bíblicos de todos los meses
}

export interface AnnualOverview {
  sy: number;
  monthsClosed: number;     // de 12
  closed: boolean;          // ya pasó el 31 de agosto
  closesOn: string;         // "31/08/2026"
  expected: number;
  received: number;
  pctReported: number | null;
  participated: number;
  totalHours: number;
  studiesAvg: number | null;  // cursos bíblicos promedio por mes cerrado
  monthsWithData: number;     // meses con resumen (divisor del promedio)
  pr: RoleTotals;
  pai: RoleTotals;   // PA indefinido: avance como PR, meta de 30 h por mes
  pa: RoleTotals;
  altas: number;
  bajas: number;
  groups: GroupTotals[];
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

/** Meses del año de servicio que ya cerraron (anteriores al mes en curso). */
export function monthsClosedIn(sy: number, today = new Date()): number {
  const current = today.getFullYear() * 12 + today.getMonth();
  return serviceYearMonths(sy).filter((m) => m.year * 12 + (m.month - 1) < current).length;
}

function roleTotals(rows: GoalCompliance[], role: string): RoleTotals {
  const r = rows.filter((c) => c.role_code === role);
  const hours = r.reduce((a, c) => a + Number(c.hours_done ?? 0), 0);
  const goal = r.reduce((a, c) => a + Number(c.goal_hours ?? 0), 0);
  const count = (s: string) => r.filter((c) => c.status === s).length;
  return {
    persons: new Set(r.map((c) => c.person_id)).size,
    hours, goal, pct: pct(hours, goal),
    met: count('CUMPLIDA'), notMet: count('NO CUMPLIDA'), onTrack: count('AL DIA'), behind: count('ATRASADO'),
  };
}

export function annualOverview(
  sy: number,
  data: { compliance: GoalCompliance[]; monthly: MonthlySummary[]; movements: PersonMovement[] },
  today = new Date(),
): AnnualOverview {
  const monthsClosed = monthsClosedIn(sy, today);
  const groups = new Map<string, GroupTotals>();
  for (const m of data.monthly) {
    const name = m.group_name ?? 'Sin grupo';
    const g = groups.get(name) ?? { group: name, expected: 0, received: 0, participated: 0, pct: null, hours: 0, studies: 0 };
    g.expected += m.persons;
    g.received += m.reports_received;
    g.participated += m.participated;
    g.hours += Number(m.total_hours ?? 0);
    g.studies += Number(m.bible_studies ?? 0);
    groups.set(name, g);
  }
  const groupList = [...groups.values()]
    .map((g) => ({ ...g, pct: pct(g.received, g.expected) }))
    .sort((a, b) => (a.group === 'Sin grupo' ? 1 : b.group === 'Sin grupo' ? -1 : a.group.localeCompare(b.group)));
  const sum = (k: 'expected' | 'received' | 'participated' | 'hours' | 'studies') => groupList.reduce((a, g) => a + g[k], 0);
  const periods = new Set(data.monthly.map((m) => m.period)).size;
  const altas = data.movements.filter((m) => m.direction === 'ALTA').length;

  return {
    sy,
    monthsClosed,
    closed: monthsClosed === 12,
    closesOn: `31/08/${sy}`,
    expected: sum('expected'),
    received: sum('received'),
    pctReported: pct(sum('received'), sum('expected')),
    participated: sum('participated'),
    totalHours: sum('hours'),
    monthsWithData: periods,
    studiesAvg: periods ? Math.round((10 * sum('studies')) / periods) / 10 : null,
    pr: roleTotals(data.compliance, 'PR'),
    pai: roleTotals(data.compliance, 'PAI'),
    pa: roleTotals(data.compliance, 'PA'),
    altas,
    bajas: data.movements.length - altas,
    groups: groupList,
  };
}

/** Frase de estado del año, igual en pantalla, Excel y PDF. */
export function yearStatusText(o: AnnualOverview): string {
  if (o.closed) return `Año cerrado el ${o.closesOn}. Los resultados de PR y PAI son finales.`;
  return `En curso: ${o.monthsClosed} de 12 meses cerrados. El año cierra el ${o.closesOn}; `
    + 'las horas de PR y PAI deben completarse antes de esa fecha.';
}

function roleLine(t: RoleTotals, closed: boolean): string {
  if (!t.persons) return 'Nadie tuvo el cargo este año';
  const parts = [`${t.met} cumplieron`];
  if (closed || t.notMet) parts.push(`${t.notMet} no cumplieron`);
  if (!closed) parts.push(`${t.onTrack} al día`, `${t.behind} atrasados`);
  return parts.join(', ');
}

export function annualSummaryTable(o: AnnualOverview): ReportTable {
  const rows: Cell[][] = [
    ['Estado del año', yearStatusText(o)],
    ['Informes recibidos', `${fmtNum(o.received)} de ${fmtNum(o.expected)} (${fmtPct(o.pctReported)})`],
    ['Informes con participación', fmtNum(o.participated)],
    ['Horas informadas', fmtNum(o.totalHours)],
    ['Cursos bíblicos (promedio por mes)', fmtNum(o.studiesAvg)],
    ['PR: personas', fmtNum(o.pr.persons)],
    ['PR: horas / meta', `${fmtNum(o.pr.hours)} de ${fmtNum(o.pr.goal)} (${fmtPct(o.pr.pct)})`],
    ['PR: resultado', roleLine(o.pr, o.closed)],
    ['PAI: personas', fmtNum(o.pai.persons)],
    ['PAI: horas / meta', `${fmtNum(o.pai.hours)} de ${fmtNum(o.pai.goal)} (${fmtPct(o.pai.pct)})`],
    ['PAI: resultado', roleLine(o.pai, o.closed)],
    ['PA: personas', fmtNum(o.pa.persons)],
    ['PA: horas / meta', `${fmtNum(o.pa.hours)} de ${fmtNum(o.pa.goal)} (${fmtPct(o.pa.pct)})`],
    ['PA: resultado', roleLine(o.pa, o.closed)],
    ['Altas', fmtNum(o.altas)],
    ['Bajas', fmtNum(o.bajas)],
  ];
  return {
    key: 'Resumen',
    title: `Informe del año de servicio ${o.sy}`,
    subtitle: `Año de servicio ${serviceYearLabel(o.sy)}`,
    columns: [{ header: 'Concepto', width: 26 }, { header: 'Valor', width: 90 }],
    rows,
    notes: [
      'El año de servicio va del 1 de septiembre al 31 de agosto; las metas de PR y PAI se miden en ese margen.',
      'PAI (PA indefinido): 30 h por cada mes con el cargo, 360 h el año completo. PA: 30 h en cada mes indicado.',
      'Los totales consideran solo meses cerrados. Las secciones siguientes tienen el detalle.',
    ],
  };
}

export function groupTotalsTable(o: AnnualOverview): ReportTable {
  return {
    key: 'Por grupo',
    title: 'Totales del año por grupo',
    subtitle: `Año de servicio ${serviceYearLabel(o.sy)} · meses cerrados`,
    columns: [
      { header: 'Grupo', width: 18 }, { header: 'Informes esperados', format: 'num' },
      { header: 'Informes recibidos', format: 'num' }, { header: '% informado', format: 'pct' },
      { header: 'Con participación', format: 'num' }, { header: 'Horas', format: 'num' },
      { header: 'Cursos (prom./mes)', format: 'num' },
    ],
    rows: [
      ...o.groups.map((g): Cell[] => [g.group, g.expected, g.received, g.pct, g.participated, g.hours, avgPerMonth(g.studies, o)]),
      ...(o.groups.length > 1
        ? [['Total', o.expected, o.received, o.pctReported, o.participated, o.totalHours, o.studiesAvg] as Cell[]]
        : []),
    ],
    notes: [
      'Cada persona cuenta en el grupo al que pertenecía ese mes.',
      'Cursos: suma de los cursos bíblicos informados cada mes, promediada entre los meses cerrados.',
    ],
  };
}

/** Promedio mensual de cursos bíblicos, con un decimal. */
export function avgPerMonth(total: number, o: AnnualOverview): number | null {
  return o.monthsWithData ? Math.round((10 * total) / o.monthsWithData) / 10 : null;
}

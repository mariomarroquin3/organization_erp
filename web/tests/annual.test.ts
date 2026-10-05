import { describe, expect, it } from 'vitest';
import { annualOverview, annualSummaryTable, groupTotalsTable, monthsClosedIn, yearStatusText } from '@/lib/export/annual';
import { toPdf } from '@/lib/export/pdf';
import { toXlsx } from '@/lib/export/xlsx';
import type { GoalCompliance, MonthlySummary, PersonMovement } from '@/lib/types';

function gc(id: string, role: string, status: GoalCompliance['status'], hours: number, goal: number): GoalCompliance {
  return {
    person_id: id, first_name: id, last_name: id, service_year: 2026, role_code: role, role_name: role,
    months_in_role: 12, months_closed: 12, months_reported: 12, months_missing: 0,
    goal_hours: goal, goal_to_date: goal, hours_done: hours, hours_remaining: Math.max(goal - hours, 0),
    pct_goal: null, pct_to_date: null, hours_needed_per_month: null, status,
  };
}
const ms = (period: string, group: string | null, persons: number, received: number, hours: number, studies = 0): MonthlySummary => ({
  period, group_name: group, persons, reports_received: received, participated: received,
  pct_reported: null, hours_role_persons: 0, total_hours: hours, bible_studies: studies,
});
const mv = (direction: 'ALTA' | 'BAJA') => ({ direction } as PersonMovement);

describe('meses cerrados del año de servicio', () => {
  it('cuenta de septiembre a agosto, solo meses anteriores al actual', () => {
    expect(monthsClosedIn(2027, new Date(2026, 9, 4))).toBe(1);   // solo sep 2026
    expect(monthsClosedIn(2026, new Date(2026, 9, 4))).toBe(12);  // sep 2025 – ago 2026 cerrado
    expect(monthsClosedIn(2026, new Date(2026, 7, 31))).toBe(11); // agosto aún abierto
    expect(monthsClosedIn(2028, new Date(2026, 9, 4))).toBe(0);
  });
});

describe('resumen del año', () => {
  const data = {
    compliance: [gc('a', 'PR', 'CUMPLIDA', 610, 600), gc('b', 'PR', 'NO CUMPLIDA', 500, 600), gc('c', 'PA', 'CUMPLIDA', 90, 90)],
    monthly: [ms('2025-09-01', 'Norte', 3, 3, 100, 2), ms('2025-09-01', null, 1, 0, 0), ms('2025-10-01', 'Norte', 3, 2, 80, 3)],
    movements: [mv('ALTA'), mv('ALTA'), mv('BAJA')],
  };

  it('año cerrado: resultados finales de PR', () => {
    const o = annualOverview(2026, data, new Date(2026, 9, 4));
    expect(o.closed).toBe(true);
    expect(o).toMatchObject({ expected: 7, received: 5, totalHours: 180, altas: 2, bajas: 1, closesOn: '31/08/2026' });
    expect(o.pr).toMatchObject({ persons: 2, met: 1, notMet: 1, hours: 1110, goal: 1200, pct: 92.5 });
    expect(o.groups.map((g) => g.group)).toEqual(['Norte', 'Sin grupo']);
    expect(yearStatusText(o)).toContain('Año cerrado el 31/08/2026');
    const t = annualSummaryTable(o);
    expect(t.rows.find((r) => r[0] === 'PR: resultado')![1]).toBe('1 cumplieron, 1 no cumplieron');
    // Cursos: 2 en sep + 3 en oct = 5 en 2 meses -> 2.5 por mes
    expect(o.studiesAvg).toBe(2.5);
    expect(t.rows.find((r) => r[0] === 'Cursos bíblicos (promedio por mes)')![1]).toMatch(/^2[.,]5$/);
    expect(groupTotalsTable(o).rows.at(-1)).toEqual(['Total', 7, 5, 71.4, 5, 180, 2.5]);
  });

  it('año en curso: recuerda que las horas de PR cierran el 31 de agosto', () => {
    const o = annualOverview(2027, { compliance: [], monthly: [], movements: [] }, new Date(2026, 9, 4));
    expect(o.closed).toBe(false);
    expect(yearStatusText(o)).toBe('En curso: 1 de 12 meses cerrados. El año cierra el 31/08/2027; las horas de PR deben completarse antes de esa fecha.');
  });

  it('se exporta a Excel y PDF', async () => {
    const o = annualOverview(2026, data, new Date(2026, 9, 4));
    const tables = [annualSummaryTable(o), groupTotalsTable(o)];
    expect((await toXlsx(tables)).length).toBeGreaterThan(1000);
    expect(toPdf(tables).subarray(0, 4).toString()).toBe('%PDF');
  });
});

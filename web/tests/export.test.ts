import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { completenessTable, complianceTable, matrixCell, matrixTable } from '@/lib/export/tables';
import { toXlsx } from '@/lib/export/xlsx';
import { toPdf } from '@/lib/export/pdf';
import type { GoalCompliance, ReportMatrixRow, ServiceYearSummary } from '@/lib/types';

const compliance: GoalCompliance[] = [{
  person_id: 'a', first_name: 'Ana', last_name: 'López', service_year: 2026, role_code: 'PR', role_name: 'PR',
  months_in_role: 12, months_closed: 12, months_reported: 12, months_missing: 0,
  goal_hours: 600, goal_to_date: 600, hours_done: 600, hours_remaining: 0, pct_goal: 100, pct_to_date: 100,
  hours_needed_per_month: null, status: 'CUMPLIDA',
}];

const summary: ServiceYearSummary[] = [{
  person_id: 'c', first_name: 'Carla', last_name: 'Méndez', group_name: 'Grupo 2', current_roles: null,
  months_expected: 12, months_reported: 10, months_participated: 10, pct_reported: 83.3, pct_participated: 83.3, total_hours: 0,
}];

function m(person: string, year: number, month: number, o: Partial<ReportMatrixRow>): ReportMatrixRow {
  return {
    person_id: person, first_name: person, last_name: person.toUpperCase(), group_name: 'G', period: `${year}-${String(month).padStart(2, '0')}-01`,
    year, month, hours_role: null, has_report: false, participated: false, hours: null, bible_studies: 0, ...o,
  };
}

describe('celdas de la matriz', () => {
  it('horas para PR/PA, Sí/No para el resto, Falta si PR/PA sin informe', () => {
    expect(matrixCell({ has_report: true, participated: true, hours: 40, hours_role: 'PR' })).toBe(40);
    expect(matrixCell({ has_report: true, participated: false, hours: 0, hours_role: 'PA' })).toBe(0);
    expect(matrixCell({ has_report: true, participated: true, hours: null, hours_role: null })).toBe('Sí');
    expect(matrixCell({ has_report: true, participated: false, hours: null, hours_role: null })).toBe('No');
    expect(matrixCell({ has_report: false, participated: false, hours: null, hours_role: 'PR' })).toBe('Falta');
    expect(matrixCell({ has_report: false, participated: false, hours: null, hours_role: null })).toBe('—');
  });

  it('agrega los cursos bíblicos cuando hay', () => {
    expect(matrixCell({ has_report: true, participated: true, hours: 40, hours_role: 'PR', bible_studies: 2 })).toBe('40 · 2 c.');
    expect(matrixCell({ has_report: true, participated: true, hours: null, hours_role: null, bible_studies: 1 })).toBe('Sí · 1 c.');
    expect(matrixCell({ has_report: true, participated: true, hours: null, hours_role: null, bible_studies: 0 })).toBe('Sí');
  });

  it('pivota a una fila por persona con 12 meses sep-ago', () => {
    const t = matrixTable([
      m('ana', 2025, 9, { hours_role: 'PR', has_report: true, participated: true, hours: 50 }),
      m('ana', 2025, 10, { hours_role: 'PR' }),
      m('carla', 2025, 9, { has_report: true, participated: true, bible_studies: 1 }),
    ], 2026);
    expect(t.columns).toHaveLength(4 + 12 + 2);
    expect(t.columns[4].header).toBe('sep 25');
    expect(t.columns[15].header).toBe('ago 26');
    const ana = t.rows.find((r) => r[0] === 'ANA')!;
    expect(ana.slice(3, 6)).toEqual(['PR', 50, 'Falta']);
    expect(ana.at(-2)).toBe(50);
    expect(ana.at(-1)).toBe(0);
    const carla = t.rows.find((r) => r[0] === 'CARLA')!;
    expect(carla[3]).toBeNull();
    expect(carla[4]).toBe('Sí · 1 c.');
    expect(carla.at(-1)).toBe(1);
  });
});

describe('archivos', () => {
  it('genera un Excel con una hoja por informe y porcentajes como fracción', async () => {
    const buf = await toXlsx([complianceTable(compliance, 2026), completenessTable(summary, 2026)]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Cumplimiento', 'Completitud']);
    const ws = wb.getWorksheet('Cumplimiento')!;
    expect(ws.getRow(4).getCell(1).value).toBe('Apellidos');
    expect(ws.getRow(5).getCell(1).value).toBe('López');
    expect(ws.getRow(5).getCell(11).value).toBe(1); // 100 % -> 1
    expect(ws.getRow(5).getCell(14).value).toBe('Cumplida');
  });

  it('genera un PDF válido', () => {
    const buf = toPdf([complianceTable(compliance, 2026), completenessTable([], 2026)]);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(2000);
  });
});

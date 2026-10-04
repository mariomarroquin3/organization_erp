import { describe, expect, it } from 'vitest';
import { allowedMovementTypes, summarizeMovements, wasMemberDuring } from '@/lib/services/movements';
import { movementsTable } from '@/lib/export/tables';
import type { MembershipPeriod, MovementType, PersonMovement } from '@/lib/types';

const P = 'p1';

describe('wasMemberDuring', () => {
  it('sin altas ni bajas cuenta siempre', () => {
    expect(wasMemberDuring([{ person_id: P, start_date: null, end_date: null }], '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('baja el 1 de marzo: cuenta febrero, no marzo', () => {
    const periods: MembershipPeriod[] = [{ person_id: P, start_date: null, end_date: '2026-02-28' }];
    expect(wasMemberDuring(periods, '2026-02-01', '2026-02-28')).toBe(true);
    expect(wasMemberDuring(periods, '2026-03-01', '2026-03-31')).toBe(false);
  });

  it('alta a mitad de mes cuenta ese mes; con baja y reingreso hay un hueco', () => {
    const periods: MembershipPeriod[] = [
      { person_id: P, start_date: '2025-01-01', end_date: '2026-02-28' },
      { person_id: P, start_date: '2026-06-15', end_date: null },
    ];
    expect(wasMemberDuring(periods, '2026-04-01', '2026-04-30')).toBe(false);
    expect(wasMemberDuring(periods, '2026-06-01', '2026-06-30')).toBe(true);
  });

  it('sin periodos (alta futura o nunca dada de alta) no cuenta', () => {
    expect(wasMemberDuring([], '2026-06-01', '2026-06-30')).toBe(false);
  });
});

const type = (code: string, direction: 'ALTA' | 'BAJA'): MovementType => ({
  id: code, code, name: code, direction, requires_congregation: code.startsWith('TRASLADO'), is_active: true, sort_order: 1,
});

describe('allowedMovementTypes', () => {
  const types = [type('NUEVO_INGRESO', 'ALTA'), type('TRASLADO_SALIDA', 'BAJA'), type('FALLECIMIENTO', 'BAJA')];
  it('activa: solo bajas; inactiva: solo altas', () => {
    expect(allowedMovementTypes(types, true).map((t) => t.code)).toEqual(['TRASLADO_SALIDA', 'FALLECIMIENTO']);
    expect(allowedMovementTypes(types, false).map((t) => t.code)).toEqual(['NUEVO_INGRESO']);
  });
});

const mov = (date: string, code: string, direction: 'ALTA' | 'BAJA', congregation: string | null = null): PersonMovement => ({
  id: date + code, person_id: P, first_name: 'Ana', last_name: 'López', movement_type_id: code,
  type_code: code, type_name: code, direction, movement_date: date, service_year: 2026, congregation, notes: null,
});

describe('resumen y exportación de altas y bajas', () => {
  const rows = [
    mov('2026-03-01', 'TRASLADO_SALIDA', 'BAJA', 'Norte'),
    mov('2025-10-01', 'TRASLADO_ENTRADA', 'ALTA', 'Sur'),
    mov('2026-01-10', 'NUEVO_INGRESO', 'ALTA'),
  ];

  it('cuenta altas, bajas y traslados', () => {
    const t = summarizeMovements(rows);
    expect([t.altas, t.bajas, t.trasladosEntrada, t.trasladosSalida]).toEqual([2, 1, 1, 1]);
  });

  it('la tabla exportada va en orden de fecha', () => {
    const t = movementsTable(rows, 2026);
    expect(t.rows.map((r) => r[0])).toEqual(['01/10/2025', '10/01/2026', '01/03/2026']);
    expect(t.rows[0][3]).toBe('Alta');
    expect(t.rows[2][5]).toBe('Norte');
    expect(t.subtitle).toContain('2 alta(s), 1 baja(s)');
  });
});

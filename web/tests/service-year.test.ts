import { describe, expect, it } from 'vitest';
import {
  lastClosedMonth, monthsPeriod, parsePeriodKey, parseServiceYear, serviceYearMonths, serviceYearOf, serviceYearOptions, shiftMonth,
} from '@/lib/service-year';

describe('año de servicio', () => {
  it('sep-dic pertenecen al año siguiente; ene-ago al mismo', () => {
    expect(serviceYearOf(2025, 9)).toBe(2026);
    expect(serviceYearOf(2025, 12)).toBe(2026);
    expect(serviceYearOf(2026, 1)).toBe(2026);
    expect(serviceYearOf(2026, 8)).toBe(2026);
  });

  it('lista los 12 meses de septiembre a agosto', () => {
    const m = serviceYearMonths(2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ year: 2025, month: 9 });
    expect(m[3]).toEqual({ year: 2025, month: 12 });
    expect(m[4]).toEqual({ year: 2026, month: 1 });
    expect(m[11]).toEqual({ year: 2026, month: 8 });
  });

  it('último mes cerrado y desplazamientos cruzan el año', () => {
    expect(lastClosedMonth(new Date(2026, 0, 15))).toEqual({ year: 2025, month: 12 });
    expect(lastClosedMonth(new Date(2026, 9, 4))).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2025, month: 12 }, 1)).toEqual({ year: 2026, month: 1 });
  });

  it('valida parámetros de la URL', () => {
    expect(parsePeriodKey('2026-03')).toEqual({ year: 2026, month: 3 });
    expect(parsePeriodKey('2026-13')).toBeNull();
    expect(parsePeriodKey('x')).toBeNull();
    const today = new Date(2026, 9, 4);
    expect(parseServiceYear('2025', today)).toBe(2025);
    expect(parseServiceYear('abc', today)).toBe(2027);
    expect(serviceYearOptions(2025, today)).toEqual([2027, 2026, 2025]);
    expect(serviceYearOptions(null, today)).toEqual([2027]);
  });
});

describe('periodo de un cargo por meses (PA)', () => {
  it('va del 1 del mes inicial al último día del mes final', () => {
    expect(monthsPeriod({ year: 2026, month: 9 }, 1)).toEqual({ start_date: '2026-09-01', end_date: '2026-09-30' });
    expect(monthsPeriod({ year: 2026, month: 12 }, 3)).toEqual({ start_date: '2026-12-01', end_date: '2027-02-28' });
    expect(monthsPeriod({ year: 2028, month: 1 }, 2)).toEqual({ start_date: '2028-01-01', end_date: '2028-02-29' });
  });
});

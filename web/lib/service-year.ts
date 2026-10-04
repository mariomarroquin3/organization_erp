// Año de servicio: de septiembre a agosto, nombrado por el año en que
// cierra (igual que service_year_of() en la base). El año de servicio
// 2026 va de sep-2025 a ago-2026.

export const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function serviceYearOf(year: number, month: number): number {
  return month >= 9 ? year + 1 : year;
}

export function serviceYearOfDate(d: Date): number {
  return serviceYearOf(d.getFullYear(), d.getMonth() + 1);
}

export function currentServiceYear(today = new Date()): number {
  return serviceYearOfDate(today);
}

export function serviceYearLabel(sy: number): string {
  return `${sy} (sep ${sy - 1} – ago ${sy})`;
}

export interface YearMonth { year: number; month: number }

/** Los 12 meses del año de servicio, de septiembre a agosto. */
export function serviceYearMonths(sy: number): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((8 + i) % 12) + 1;
    return { year: m >= 9 ? sy - 1 : sy, month: m };
  });
}

/** Último mes cerrado (el anterior al mes en curso). */
export function lastClosedMonth(today = new Date()): YearMonth {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

export function periodKey({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** "2026-03" -> {2026, 3}; null si no es válido. */
export function parsePeriodKey(s: string | undefined | null): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { year, month };
}

export function periodDate({ year, month }: YearMonth): string {
  return `${periodKey({ year, month })}-01`;
}

export function monthLabel({ year, month }: YearMonth): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Año de servicio pedido en la URL, o el actual. */
export function parseServiceYear(s: string | undefined | null, today = new Date()): number {
  const n = Number(s);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : currentServiceYear(today);
}

/** Años seleccionables: desde el primero con datos hasta el actual. */
export function serviceYearOptions(firstWithData: number | null, today = new Date()): number[] {
  const current = currentServiceYear(today);
  const from = Math.min(firstWithData ?? current, current);
  const out: number[] = [];
  for (let y = current; y >= from; y--) out.push(y);
  return out;
}

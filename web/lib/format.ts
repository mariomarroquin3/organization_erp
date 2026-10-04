const num = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });

export function fmtNum(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  return num.format(Number(n));
}

export function fmtPct(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  return `${num.format(Number(n))} %`;
}

/** "2026-03-15" -> "15/03/2026" sin pasar por zonas horarias. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function fullName(p: { first_name: string; last_name: string }): string {
  return `${p.last_name}, ${p.first_name}`;
}

export const STATUS_LABEL: Record<string, string> = {
  CUMPLIDA: 'Cumplida',
  'AL DIA': 'Al día',
  ATRASADO: 'Atrasado',
  'NO CUMPLIDA': 'No cumplida',
  'SIN META': 'Sin meta',
};

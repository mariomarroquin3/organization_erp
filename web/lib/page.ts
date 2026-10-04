import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { firstServiceYearWithData } from '@/lib/services/reports';
import { parseServiceYear, serviceYearOptions } from '@/lib/service-year';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Cliente + año de servicio elegido (?anio=) + opciones del selector. */
export async function yearContext(spPromise: SearchParams) {
  const sp = await spPromise;
  const db = await createClient();
  const sy = parseServiceYear(param(sp, 'anio'));
  const years = serviceYearOptions(await firstServiceYearWithData(db));
  return { db, sp, sy, years };
}

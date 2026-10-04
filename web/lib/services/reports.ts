import type { Db } from '@/lib/supabase/server';
import { periodDate, type YearMonth } from '@/lib/service-year';
import { check, ServiceError } from './errors';
import { listMembershipPeriods, wasMemberDuring } from './movements';
import { planMonthSave, type ExistingReport, type PersonInfo, type SheetEntry } from './report-plan';

export interface SheetRow {
  person_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  group_name: string | null;
  hours_role: string | null;  // PR / PA ese mes
  report: ExistingReport | null;
}

/**
 * Hoja de captura de un mes: personas que eran miembros ese mes (según
 * sus altas y bajas) y las que ya tienen informe, con su grupo y su
 * cargo con horas en ese mes.
 */
export async function getMonthSheet(db: Db, ym: YearMonth): Promise<SheetRow[]> {
  const start = periodDate(ym);
  const end = lastDayOfMonth(ym);
  const [persons, groups, roles, reports, periods] = await Promise.all([
    db.from('persons').select('id, first_name, last_name, is_active').order('last_name').order('first_name'),
    db.from('person_group_history').select('person_id, start_date, catalog_groups(name)')
      .lte('start_date', end).or(`end_date.is.null,end_date.gte.${start}`)
      .order('start_date', { ascending: false }),
    db.from('view_hours_role_months').select('person_id, role_code').eq('period', start),
    db.from('monthly_reports').select('id, person_id, participated, hours').eq('year', ym.year).eq('month', ym.month),
    listMembershipPeriods(db),
  ]);
  const periodsOf = new Map<string, typeof periods>();
  for (const p of periods) periodsOf.set(p.person_id, [...(periodsOf.get(p.person_id) ?? []), p]);

  const groupOf = new Map<string, string>();
  for (const g of check(groups) as unknown as { person_id: string; catalog_groups: { name: string } | null }[]) {
    if (!groupOf.has(g.person_id) && g.catalog_groups) groupOf.set(g.person_id, g.catalog_groups.name);
  }
  const roleOf = new Map((check(roles) as { person_id: string; role_code: string }[]).map((r) => [r.person_id, r.role_code]));
  const reportOf = new Map((check(reports) as ExistingReport[]).map((r) => [r.person_id, r]));

  return (check(persons) as { id: string; first_name: string; last_name: string; is_active: boolean }[])
    .filter((p) => reportOf.has(p.id) || wasMemberDuring(periodsOf.get(p.id) ?? [], start, end))
    .map((p) => ({
      person_id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      is_active: p.is_active,
      group_name: groupOf.get(p.id) ?? null,
      hours_role: roleOf.get(p.id) ?? null,
      report: reportOf.get(p.id) ?? null,
    }));
}

export interface SaveResult { saved: number; deleted: number; errors: string[] }

/** Guarda la hoja completa. Si algún renglón no es válido no se guarda nada. */
export async function saveMonthSheet(db: Db, ym: YearMonth, entries: SheetEntry[]): Promise<SaveResult> {
  const sheet = await getMonthSheet(db, ym);
  const people = new Map<string, PersonInfo>(sheet.map((r) => [
    r.person_id, { name: `${r.first_name} ${r.last_name}`, hoursRole: r.hours_role },
  ]));
  const existing = sheet.flatMap((r) => (r.report ? [{ ...r.report, person_id: r.person_id }] : []));
  const plan = planMonthSave(ym.year, ym.month, entries, existing, people);
  if (plan.errors.length) return { saved: 0, deleted: 0, errors: plan.errors };

  if (plan.upserts.length) {
    check(await db.from('monthly_reports').upsert(plan.upserts, { onConflict: 'person_id,year,month' }));
  }
  if (plan.deletes.length) {
    check(await db.from('monthly_reports').delete().in('id', plan.deletes));
  }
  return { saved: plan.upserts.length, deleted: plan.deletes.length, errors: [] };
}

/** Guarda o borra el informe de una persona en un mes (ficha de persona). */
export async function savePersonMonth(db: Db, person_id: string, ym: YearMonth, entry: Omit<SheetEntry, 'person_id'>) {
  const res = await saveMonthSheet(db, ym, [{ person_id, ...entry }]);
  if (res.errors.length) throw new ServiceError(res.errors.join(' '));
  return res;
}

/** Primer año de servicio con informes, para el selector de años. */
export async function firstServiceYearWithData(db: Db): Promise<number | null> {
  const rows = check(await db.from('monthly_reports').select('service_year')
    .order('service_year').limit(1)) as { service_year: number }[];
  return rows[0]?.service_year ?? null;
}

function lastDayOfMonth({ year, month }: YearMonth): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

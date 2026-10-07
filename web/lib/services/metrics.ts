import type { Db } from '@/lib/supabase/server';
import type {
  ComplianceStatus, GoalCompliance, MonthlySummary, PersonOverview, ReportMatrixRow, ServiceYearSummary,
} from '@/lib/types';
import { HOURS_ROLES, compareHoursRoles } from '@/lib/roles';
import { check, fetchAll } from './errors';

// Las métricas se calculan en la base (vistas y funciones de la
// migración 0400). Aquí solo se piden y se resumen para el panel.

export async function goalCompliance(db: Db, serviceYear: number, f: { role?: string; status?: string; personId?: string } = {}) {
  let q = db.from('view_goal_compliance').select('*').eq('service_year', serviceYear)
    .order('role_code').order('last_name').order('first_name');
  if (f.role) q = q.eq('role_code', f.role);
  if (f.status) q = q.eq('status', f.status);
  if (f.personId) q = q.eq('person_id', f.personId);
  // La base ordena por código (PA, PAI, PR); se presentan PR, PAI, PA
  return (check(await q) as GoalCompliance[]).sort((a, b) => compareHoursRoles(a.role_code, b.role_code));
}

export async function serviceYearSummary(db: Db, serviceYear: number) {
  return check(await db.rpc('fn_service_year_summary', { p_service_year: serviceYear })) as ServiceYearSummary[];
}

export async function monthlySummary(db: Db, serviceYear: number) {
  return check(await db.rpc('fn_monthly_summary', { p_service_year: serviceYear })) as MonthlySummary[];
}

export async function reportMatrix(db: Db, serviceYear: number) {
  return fetchAll<ReportMatrixRow>((from, to) => db.rpc('fn_report_matrix', { p_service_year: serviceYear })
    .order('last_name').order('first_name').order('person_id').order('period').range(from, to));
}

export async function personsOverview(db: Db) {
  return fetchAll<PersonOverview>((from, to) => db.from('view_persons_overview').select('*')
    .order('last_name').order('first_name').order('person_id').range(from, to));
}

/** Personas sin cargo PR, PAI ni PA: su métrica es la completitud sí/no. */
export function isWithoutHoursRole(roles: string | null): boolean {
  const list = (roles ?? '').split(', ').filter(Boolean);
  return !HOURS_ROLES.some((r) => list.includes(r));
}

export interface DashboardData {
  activePersons: number;
  byStatus: Record<ComplianceStatus, number>;
  byRole: { role: string; persons: number; goal: number; done: number }[];
  lastMonth: { period: string; persons: number; received: number } | null;
  avgReported: number | null;
  avgParticipatedOthers: number | null;
  behind: GoalCompliance[];
  lowCompleteness: ServiceYearSummary[];
}

export async function dashboard(db: Db, serviceYear: number): Promise<DashboardData> {
  const [compliance, summary, monthly, active] = await Promise.all([
    goalCompliance(db, serviceYear),
    serviceYearSummary(db, serviceYear),
    monthlySummary(db, serviceYear),
    db.from('persons').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  if (active.error) check(active);
  return summarizeDashboard(compliance, summary, monthly, active.count ?? 0);
}

export function summarizeDashboard(
  compliance: GoalCompliance[],
  summary: ServiceYearSummary[],
  monthly: MonthlySummary[],
  activePersons: number,
): DashboardData {
  const byStatus = { CUMPLIDA: 0, 'AL DIA': 0, ATRASADO: 0, 'NO CUMPLIDA': 0, 'SIN META': 0 } as Record<ComplianceStatus, number>;
  const roles = new Map<string, { role: string; persons: number; goal: number; done: number }>();
  for (const c of compliance) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const r = roles.get(c.role_code) ?? { role: c.role_code, persons: 0, goal: 0, done: 0 };
    r.persons += 1;
    r.goal += Number(c.goal_hours ?? 0);
    r.done += Number(c.hours_done ?? 0);
    roles.set(c.role_code, r);
  }

  // Último mes cerrado con datos del año: suma de todos los grupos
  let lastMonth: DashboardData['lastMonth'] = null;
  const lastPeriod = monthly.reduce<string | null>((acc, m) => (acc === null || m.period > acc ? m.period : acc), null);
  if (lastPeriod) {
    const rows = monthly.filter((m) => m.period === lastPeriod);
    lastMonth = {
      period: lastPeriod,
      persons: rows.reduce((a, m) => a + m.persons, 0),
      received: rows.reduce((a, m) => a + m.reports_received, 0),
    };
  }

  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null).map(Number);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  const others = summary.filter((s) => isWithoutHoursRole(s.current_roles));

  return {
    activePersons,
    byStatus,
    byRole: [...roles.values()].sort((a, b) => compareHoursRoles(a.role, b.role)),
    lastMonth,
    avgReported: avg(summary.map((s) => s.pct_reported)),
    avgParticipatedOthers: avg(others.map((s) => s.pct_participated)),
    behind: compliance.filter((c) => c.status === 'ATRASADO' || c.status === 'NO CUMPLIDA'),
    lowCompleteness: summary
      .filter((s) => s.pct_reported !== null && Number(s.pct_reported) < 100)
      .sort((a, b) => Number(a.pct_reported) - Number(b.pct_reported))
      .slice(0, 10),
  };
}

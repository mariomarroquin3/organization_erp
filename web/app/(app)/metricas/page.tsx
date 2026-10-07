import Link from 'next/link';
import { YearSelect } from '@/components/YearSelect';
import { Empty, PageHeader, Progress, StatusBadge } from '@/components/ui';
import { goalCompliance, isWithoutHoursRole, monthlySummary, serviceYearSummary } from '@/lib/services/metrics';
import { STATUS_LABEL, fmtNum, fmtPct, fullName } from '@/lib/format';
import { MONTH_SHORT } from '@/lib/service-year';
import { param, yearContext, type SearchParams } from '@/lib/page';
import { requireAreaPage } from '@/lib/services/session';
import { GOAL_RULES_NOTE, HOURS_ROLES } from '@/lib/roles';

const TABS = [
  { key: 'cumplimiento', label: 'Metas PR / PAI / PA' },
  { key: 'completitud', label: 'Completitud por persona' },
  { key: 'mensual', label: 'Resumen mensual' },
] as const;

export default async function MetricasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAreaPage('METRICAS');
  const { db, sp, sy, years } = await yearContext(searchParams);
  const tab = TABS.find((t) => t.key === param(sp, 'vista'))?.key ?? 'cumplimiento';
  const href = (extra: Record<string, string>) => `/metricas?${new URLSearchParams({ anio: String(sy), vista: tab, ...extra })}`;

  return (
    <>
      <PageHeader title="Métricas">
        <YearSelect value={sy} options={years} />
        <Link className="btn-secondary" href={`/exportar?anio=${sy}`}>Exportar</Link>
      </PageHeader>
      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/metricas?anio=${sy}&vista=${t.key}`} className={t.key === tab ? 'active' : undefined}>{t.label}</Link>
        ))}
      </nav>
      {tab === 'cumplimiento' ? <Compliance db={db} sy={sy} role={param(sp, 'cargo')} status={param(sp, 'estado')} href={href} /> : null}
      {tab === 'completitud' ? <Completeness db={db} sy={sy} onlyOthers={param(sp, 'solo') === 'otros'} href={href} /> : null}
      {tab === 'mensual' ? <Monthly db={db} sy={sy} /> : null}
    </>
  );
}

type Db = Awaited<ReturnType<typeof yearContext>>['db'];

async function Compliance({ db, sy, role, status, href }: {
  db: Db; sy: number; role?: string; status?: string; href: (e: Record<string, string>) => string;
}) {
  const rows = await goalCompliance(db, sy, { role, status });
  return (
    <div className="card">
      <div className="toolbar">
        <span>Cargo:</span>
        {['', ...HOURS_ROLES].map((r) => (
          <Link key={r || 'all'} className={`chip${(role ?? '') === r ? ' on' : ''}`} href={href({ ...(r && { cargo: r }), ...(status && { estado: status }) })}>{r || 'Todos'}</Link>
        ))}
        <span>Estado:</span>
        {['', ...Object.keys(STATUS_LABEL)].map((s) => (
          <Link key={s || 'all'} className={`chip${(status ?? '') === s ? ' on' : ''}`} href={href({ ...(role && { cargo: role }), ...(s && { estado: s }) })}>{s ? STATUS_LABEL[s] : 'Todos'}</Link>
        ))}
      </div>
      {rows.length === 0 ? <Empty>No hay resultados.</Empty> : (
        <table className="table">
          <thead>
            <tr>
              <th>Persona</th><th>Cargo</th><th className="num">Meses</th><th className="num">Faltan informes</th>
              <th className="num">Horas</th><th className="num">Meta</th><th>Avance</th>
              <th className="num">Meta a la fecha</th><th className="num">h/mes necesarias</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.person_id}-${c.role_code}`}>
                <td><Link href={`/personas/${c.person_id}?anio=${sy}`}>{fullName(c)}</Link></td>
                <td>{c.role_code}</td>
                <td className="num">{c.months_closed}/{c.months_in_role}</td>
                <td className="num">{c.months_missing || ''}</td>
                <td className="num">{fmtNum(c.hours_done)}</td>
                <td className="num">{fmtNum(c.goal_hours)}</td>
                <td><Progress value={c.pct_goal} /> {fmtPct(c.pct_goal)}</td>
                <td className="num">{fmtNum(c.goal_to_date)}</td>
                <td className="num">{fmtNum(c.hours_needed_per_month)}</td>
                <td><StatusBadge status={c.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">{GOAL_RULES_NOTE} “A la fecha” cuenta solo meses cerrados.</p>
    </div>
  );
}

async function Completeness({ db, sy, onlyOthers, href }: {
  db: Db; sy: number; onlyOthers: boolean; href: (e: Record<string, string>) => string;
}) {
  const all = await serviceYearSummary(db, sy);
  const rows = onlyOthers ? all.filter((r) => isWithoutHoursRole(r.current_roles)) : all;
  return (
    <div className="card">
      <div className="toolbar">
        <Link className={`chip${!onlyOthers ? ' on' : ''}`} href={href({})}>Todas las personas</Link>
        <Link className={`chip${onlyOthers ? ' on' : ''}`} href={href({ solo: 'otros' })}>Solo quienes no son PR, PAI ni PA</Link>
      </div>
      {rows.length === 0 ? <Empty>Aún no hay meses cerrados en este año de servicio.</Empty> : (
        <table className="table">
          <thead>
            <tr>
              <th>Persona</th><th>Grupo</th><th>Cargos</th><th className="num">Informados</th><th>Completitud</th>
              <th className="num">Participó</th><th>Participación</th><th className="num">Horas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.person_id}>
                <td><Link href={`/personas/${s.person_id}?anio=${sy}`}>{fullName(s)}</Link></td>
                <td>{s.group_name ?? '—'}</td>
                <td>{s.current_roles ?? <span className="muted">Sin cargo</span>}</td>
                <td className="num">{s.months_reported}/{s.months_expected}</td>
                <td><Progress value={s.pct_reported} /> {fmtPct(s.pct_reported)}</td>
                <td className="num">{s.months_participated}/{s.months_expected}</td>
                <td><Progress value={s.pct_participated} /> {fmtPct(s.pct_participated)}</td>
                <td className="num">{fmtNum(s.total_hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

async function Monthly({ db, sy }: { db: Db; sy: number }) {
  const rows = await monthlySummary(db, sy);
  return (
    <div className="card">
      {rows.length === 0 ? <Empty>Aún no hay meses cerrados en este año de servicio.</Empty> : (
        <table className="table">
          <thead>
            <tr><th>Mes</th><th>Grupo</th><th className="num">Personas</th><th className="num">Informes</th><th>% informado</th><th className="num">Participaron</th><th className="num">PR/PAI/PA</th><th className="num">Horas</th><th className="num">Cursos</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [y, m] = r.period.split('-').map(Number);
              return (
                <tr key={`${r.period}-${r.group_name}`}>
                  <td><Link href={`/informes?mes=${r.period.slice(0, 7)}`}>{MONTH_SHORT[m - 1]} {y}</Link></td>
                  <td>{r.group_name ?? 'Sin grupo'}</td>
                  <td className="num">{r.persons}</td>
                  <td className="num">{r.reports_received}</td>
                  <td><Progress value={r.pct_reported} /> {fmtPct(r.pct_reported)}</td>
                  <td className="num">{r.participated}</td>
                  <td className="num">{r.hours_role_persons}</td>
                  <td className="num">{fmtNum(r.total_hours)}</td>
                  <td className="num">{r.bible_studies}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

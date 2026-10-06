import Link from 'next/link';
import { YearSelect } from '@/components/YearSelect';
import { Empty, Kpi, PageHeader, Progress, StatusBadge } from '@/components/ui';
import { dashboard } from '@/lib/services/metrics';
import { fmtNum, fmtPct, fullName } from '@/lib/format';
import { monthLabel } from '@/lib/service-year';
import { yearContext, type SearchParams } from '@/lib/page';
import { can, requireSession, type Session } from '@/lib/services/session';
import { AREAS, AREA_INFO, LEVEL_LABEL } from '@/lib/permissions';

const AREA_HREF = {
  PERSONAS: '/personas', MOVIMIENTOS: '/movimientos', INFORMES: '/informes', METRICAS: '/metricas', CONFIGURACION: '/configuracion',
} as const;

// Sin acceso a Métricas el panel solo lista las áreas de la cuenta
function Welcome({ session }: { session: Session }) {
  const mine = AREAS.filter((a) => session.areas[a]);
  return (
    <>
      <PageHeader title="Inicio" />
      <section className="card">
        {mine.length === 0 ? <Empty>Tu cuenta aún no tiene acceso a ninguna área. Pide acceso a un super administrador.</Empty> : (
          <table className="table">
            <thead><tr><th>Área</th><th>Acceso</th><th></th></tr></thead>
            <tbody>
              {mine.map((a) => (
                <tr key={a}>
                  <td><Link href={AREA_HREF[a]}>{AREA_INFO[a].label}</Link></td>
                  <td>{LEVEL_LABEL[session.areas[a]!]}</td>
                  <td className="muted">{AREA_INFO[a].description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!session.allGroups ? <p className="muted small">Ves a las personas de: {session.groups.map((g) => g.name).join(', ')}.</p> : null}
      </section>
    </>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  if (!can(session, 'METRICAS')) return <Welcome session={session} />;
  const { db, sy, years } = await yearContext(searchParams);
  const d = await dashboard(db, sy);
  const lastMonth = d.lastMonth
    ? { label: monthLabel({ year: Number(d.lastMonth.period.slice(0, 4)), month: Number(d.lastMonth.period.slice(5, 7)) }), ...d.lastMonth }
    : null;

  return (
    <>
      <PageHeader title="Panel">
        <YearSelect value={sy} options={years} />
      </PageHeader>

      <section className="kpis">
        <Kpi label="Personas activas" value={d.activePersons} />
        <Kpi
          label={lastMonth ? `Informes de ${lastMonth.label}` : 'Informes del último mes'}
          value={lastMonth ? `${lastMonth.received} / ${lastMonth.persons}` : '—'}
          hint={lastMonth ? <Link href={`/informes?mes=${lastMonth.period.slice(0, 7)}`}>Capturar faltantes</Link> : 'Aún no cierra ningún mes'}
        />
        <Kpi label="Completitud promedio" value={fmtPct(d.avgReported)} hint="Meses informados / meses cerrados" />
        <Kpi label="Participación (sin PR/PA)" value={fmtPct(d.avgParticipatedOthers)} hint="Promedio de meses con participación" />
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Metas PR / PA</h2>
          {d.byRole.length === 0 ? <Empty>Nadie tuvo cargo PR o PA en este año de servicio.</Empty> : (
            <table className="table">
              <thead><tr><th>Cargo</th><th className="num">Personas</th><th className="num">Horas</th><th className="num">Meta</th><th>Avance</th></tr></thead>
              <tbody>
                {d.byRole.map((r) => {
                  const pct = r.goal ? Math.round((1000 * r.done) / r.goal) / 10 : null;
                  return (
                    <tr key={r.role}>
                      <td><strong>{r.role}</strong></td>
                      <td className="num">{r.persons}</td>
                      <td className="num">{fmtNum(r.done)}</td>
                      <td className="num">{fmtNum(r.goal)}</td>
                      <td><Progress value={pct} /> {fmtPct(pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="status-row">
            {Object.entries(d.byStatus).filter(([, n]) => n > 0).map(([s, n]) => (
              <Link key={s} href={`/metricas?anio=${sy}&estado=${encodeURIComponent(s)}`} className="status-chip">
                <StatusBadge status={s} /> {n}
              </Link>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Requieren atención</h2>
          {d.behind.length === 0 ? <Empty>Nadie va atrasado en su meta.</Empty> : (
            <table className="table">
              <thead><tr><th>Persona</th><th>Cargo</th><th className="num">Horas / meta a la fecha</th><th>Estado</th></tr></thead>
              <tbody>
                {d.behind.map((c) => (
                  <tr key={`${c.person_id}-${c.role_code}`}>
                    <td><Link href={`/personas/${c.person_id}?anio=${sy}`}>{fullName(c)}</Link></td>
                    <td>{c.role_code}</td>
                    <td className="num">{fmtNum(c.hours_done)} / {fmtNum(c.goal_to_date)}</td>
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Menor completitud de informes</h2>
        {d.lowCompleteness.length === 0 ? <Empty>Todos tienen sus informes completos.</Empty> : (
          <table className="table">
            <thead><tr><th>Persona</th><th>Grupo</th><th>Cargos</th><th className="num">Informados</th><th>Completitud</th></tr></thead>
            <tbody>
              {d.lowCompleteness.map((s) => (
                <tr key={s.person_id}>
                  <td><Link href={`/personas/${s.person_id}?anio=${sy}`}>{fullName(s)}</Link></td>
                  <td>{s.group_name ?? '—'}</td>
                  <td>{s.current_roles ?? 'Sin cargo'}</td>
                  <td className="num">{s.months_reported} / {s.months_expected}</td>
                  <td><Progress value={s.pct_reported} /> {fmtPct(s.pct_reported)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

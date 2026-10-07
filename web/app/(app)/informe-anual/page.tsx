import Link from 'next/link';
import { YearSelect } from '@/components/YearSelect';
import { Empty, Kpi, PageHeader, Progress, StatusBadge } from '@/components/ui';
import { loadAnnualOverview } from '@/lib/export/build';
import { avgPerMonth, yearStatusText, type RoleTotals } from '@/lib/export/annual';
import { goalCompliance } from '@/lib/services/metrics';
import { fmtNum, fmtPct, fullName } from '@/lib/format';
import { serviceYearLabel } from '@/lib/service-year';
import { yearContext, type SearchParams } from '@/lib/page';
import { requireAreaPage } from '@/lib/services/session';
import { HOURS_ROLE_TITLE } from '@/lib/roles';

export default async function InformeAnualPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAreaPage('METRICAS');
  const { db, sy, years } = await yearContext(searchParams);
  const [o, compliance] = await Promise.all([loadAnnualOverview(db, sy), goalCompliance(db, sy)]);
  const link = (format: 'xlsx' | 'pdf') => `/api/export?informe=anual&anio=${sy}&formato=${format}`;
  // PR y PAI siguen todo el año: su resultado se lista persona por persona
  const yearly = compliance.filter((c) => c.role_code === 'PR' || c.role_code === 'PAI');

  return (
    <>
      <PageHeader title={`Informe del año de servicio ${sy}`}>
        <YearSelect value={sy} options={years} />
        <a className="btn" href={link('xlsx')}>Descargar Excel</a>
        <a className="btn-secondary" href={link('pdf')}>Descargar PDF</a>
      </PageHeader>

      <p className={o.closed ? 'msg msg-ok' : 'note'}>{yearStatusText(o)}</p>

      <section className="kpis">
        <Kpi label="Meses cerrados" value={`${o.monthsClosed} / 12`} hint={serviceYearLabel(sy)} />
        <Kpi label="Informes recibidos" value={`${fmtNum(o.received)} / ${fmtNum(o.expected)}`} hint={fmtPct(o.pctReported)} />
        <Kpi label="Horas informadas" value={fmtNum(o.totalHours)} />
        <Kpi label="Cursos bíblicos" value={fmtNum(o.studiesAvg)} hint="promedio por mes" />
        <Kpi label="Altas / bajas" value={`${o.altas} / ${o.bajas}`} />
      </section>

      <section className="grid-3">
        <RoleCard title={HOURS_ROLE_TITLE.PR} t={o.pr} closed={o.closed} />
        <RoleCard title={HOURS_ROLE_TITLE.PAI} t={o.pai} closed={o.closed} />
        <RoleCard title={HOURS_ROLE_TITLE.PA} t={o.pa} closed={o.closed} />
      </section>

      <div className="card">
        <h2>Resultado de cada PR y PAI</h2>
        {yearly.length === 0 ? <Empty>Nadie tuvo cargo PR ni PAI en este año de servicio.</Empty> : (
          <table className="table">
            <thead>
              <tr><th>Persona</th><th>Cargo</th><th className="num">Meses</th><th className="num">Horas</th><th className="num">Meta</th><th>Avance</th><th className="num">Faltan</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {yearly.map((c) => (
                <tr key={`${c.person_id}-${c.role_code}`}>
                  <td><Link href={`/personas/${c.person_id}?anio=${sy}`}>{fullName(c)}</Link></td>
                  <td>{c.role_code}</td>
                  <td className="num">{c.months_closed}/{c.months_in_role}</td>
                  <td className="num">{fmtNum(c.hours_done)}</td>
                  <td className="num">{fmtNum(c.goal_hours)}</td>
                  <td><Progress value={c.pct_goal} /> {fmtPct(c.pct_goal)}</td>
                  <td className="num">{Number(c.hours_remaining) ? fmtNum(c.hours_remaining) : ''}</td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Totales por grupo</h2>
        {o.groups.length === 0 ? <Empty>Aún no hay meses cerrados en este año de servicio.</Empty> : (
          <table className="table">
            <thead>
              <tr><th>Grupo</th><th className="num">Informes</th><th>% informado</th><th className="num">Con participación</th><th className="num">Horas</th><th className="num">Cursos (prom./mes)</th></tr>
            </thead>
            <tbody>
              {o.groups.map((g) => (
                <tr key={g.group}>
                  <td>{g.group}</td>
                  <td className="num">{g.received}/{g.expected}</td>
                  <td><Progress value={g.pct} /> {fmtPct(g.pct)}</td>
                  <td className="num">{g.participated}</td>
                  <td className="num">{fmtNum(g.hours)}</td>
                  <td className="num">{fmtNum(avgPerMonth(g.studies, o))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">El archivo descargado incluye además el detalle mes a mes, la completitud por persona y las altas y bajas del año.</p>
      </div>
    </>
  );
}

function RoleCard({ title, t, closed }: { title: string; t: RoleTotals; closed: boolean }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {t.persons === 0 ? <Empty>Nadie tuvo el cargo en este año de servicio.</Empty> : (
        <>
          <p><strong>{t.persons}</strong> persona(s) · {fmtNum(t.hours)} de {fmtNum(t.goal)} h</p>
          <p><Progress value={t.pct} /> {fmtPct(t.pct)}</p>
          <p>
            <StatusBadge status="CUMPLIDA" /> {t.met}{' '}
            {closed || t.notMet ? <><StatusBadge status="NO CUMPLIDA" /> {t.notMet}{' '}</> : null}
            {closed ? null : <><StatusBadge status="AL DIA" /> {t.onTrack}{' '}<StatusBadge status="ATRASADO" /> {t.behind}</>}
          </p>
        </>
      )}
    </div>
  );
}

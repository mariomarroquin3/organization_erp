import Link from 'next/link';
import { YearSelect } from '@/components/YearSelect';
import { Empty, Kpi, PageHeader } from '@/components/ui';
import { listMovements, summarizeMovements } from '@/lib/services/movements';
import { fmtDate } from '@/lib/format';
import { param, yearContext, type SearchParams } from '@/lib/page';
import { requireAreaPage } from '@/lib/services/session';

export default async function MovimientosPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAreaPage('MOVIMIENTOS');
  const { db, sp, sy, years } = await yearContext(searchParams);
  const dir = param(sp, 'tipo') === 'altas' ? 'ALTA' : param(sp, 'tipo') === 'bajas' ? 'BAJA' : null;
  const all = await listMovements(db, { serviceYear: sy });
  const totals = summarizeMovements(all);
  const rows = dir ? all.filter((m) => m.direction === dir) : all;

  return (
    <>
      <PageHeader title="Altas y bajas">
        <YearSelect value={sy} options={years} />
        <a className="btn-secondary" href={`/api/export?informe=movimientos&anio=${sy}&formato=xlsx`}>Excel</a>
        <a className="btn-secondary" href={`/api/export?informe=movimientos&anio=${sy}&formato=pdf`}>PDF</a>
      </PageHeader>

      <section className="kpis">
        <Kpi label="Altas" value={totals.altas} hint={`${totals.trasladosEntrada} por traslado`} />
        <Kpi label="Bajas" value={totals.bajas} hint={`${totals.trasladosSalida} por traslado`} />
        <Kpi label="Saldo" value={totals.altas - totals.bajas} hint={`Año de servicio ${sy}`} />
      </section>

      <form className="toolbar" action="/movimientos">
        <input type="hidden" name="anio" value={sy} />
        <select name="tipo" defaultValue={param(sp, 'tipo') ?? ''} aria-label="Tipo">
          <option value="">Altas y bajas</option>
          <option value="altas">Solo altas</option>
          <option value="bajas">Solo bajas</option>
        </select>
        <button className="btn-secondary" type="submit">Filtrar</button>
        <span className="muted">{rows.length} registro(s)</span>
      </form>

      <div className="card">
        {rows.length === 0 ? <Empty>No hay altas ni bajas en este año de servicio.</Empty> : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Persona</th><th>Movimiento</th><th>Congregación</th><th>Notas</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.movement_date)}</td>
                  <td><Link href={`/personas/${m.person_id}`}>{m.last_name}, {m.first_name}</Link></td>
                  <td><span className={`badge ${m.direction === 'ALTA' ? 'badge-ok' : 'badge-muted'}`}>{m.direction === 'ALTA' ? 'Alta' : 'Baja'}</span> {m.type_name}</td>
                  <td>{m.congregation ?? '—'}</td>
                  <td>{m.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Las altas y bajas se registran desde la ficha de cada persona. Las personas nuevas pueden darse de alta al crearlas.</p>
      </div>
    </>
  );
}

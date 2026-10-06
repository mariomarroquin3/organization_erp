import Link from 'next/link';
import { PageHeader, ReadOnlyNote } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { getMonthSheet } from '@/lib/services/reports';
import { can, requireAreaPage } from '@/lib/services/session';
import { lastClosedMonth, monthLabel, parsePeriodKey, periodKey, serviceYearOf, shiftMonth } from '@/lib/service-year';
import { param, type SearchParams } from '@/lib/page';
import { MonthSheet } from './MonthSheet';

export default async function InformesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAreaPage('INFORMES');
  const canEdit = can(session, 'INFORMES', 'edit');
  const sp = await searchParams;
  const now = new Date();
  const current = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  let ym = parsePeriodKey(param(sp, 'mes')) ?? lastClosedMonth(now);
  if (periodKey(ym) > periodKey(current)) ym = current;
  const mes = periodKey(ym);

  const db = await createClient();
  const rows = await getMonthSheet(db, ym);
  const prev = periodKey(shiftMonth(ym, -1));
  const next = shiftMonth(ym, 1);
  const canGoNext = periodKey(next) <= periodKey(current);

  return (
    <>
      <PageHeader title={`Informes de ${monthLabel(ym)}`}>
        <Link className="btn-secondary" href={`/informes?mes=${prev}`}>← Mes anterior</Link>
        <form className="inline" action="/informes">
          <input type="month" name="mes" defaultValue={mes} max={periodKey(current)} aria-label="Mes" />
          <button className="btn-secondary" type="submit">Ir</button>
        </form>
        {canGoNext ? <Link className="btn-secondary" href={`/informes?mes=${periodKey(next)}`}>Mes siguiente →</Link> : null}
      </PageHeader>
      <p className="muted">
        Año de servicio {serviceYearOf(ym.year, ym.month)}. Quien era PR o PA ese mes debe informar horas (0 si no hubo);
        el resto solo indica si participó.
      </p>
      {!canEdit ? <ReadOnlyNote /> : null}
      {/* key: reinicia el estado del formulario al cambiar de mes */}
      <MonthSheet key={mes} rows={rows} mes={mes} canEdit={canEdit} anio={serviceYearOf(ym.year, ym.month)} />
    </>
  );
}

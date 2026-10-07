import { YearSelect } from '@/components/YearSelect';
import { PageHeader } from '@/components/ui';
import { REPORTS, REPORT_KEYS } from '@/lib/export/tables';
import { yearContext, type SearchParams } from '@/lib/page';
import { requireAreaPage } from '@/lib/services/session';

const DESCRIPTIONS: Record<string, string> = {
  cumplimiento: 'Horas, meta, avance y estado de cada PR, PAI y PA.',
  completitud: 'Meses informados y con participación por persona (incluye a quienes no son PR, PAI ni PA).',
  matriz: 'Una fila por persona y una columna por mes: horas para PR/PAI/PA, Sí/No para el resto.',
  mensual: 'Informes recibidos, participación y horas por mes y grupo.',
  personas: 'Listado actual con grupo, cargos y última alta o baja.',
  movimientos: 'Altas (nuevo ingreso, traslado, reingreso) y bajas del año, con congregación de origen o destino.',
};

export default async function ExportarPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAreaPage('METRICAS');
  const { sy, years } = await yearContext(searchParams);
  const link = (key: string, format: 'xlsx' | 'pdf') => `/api/export?informe=${key}&anio=${sy}&formato=${format}`;
  return (
    <>
      <PageHeader title="Exportar informes">
        <YearSelect value={sy} options={years} />
      </PageHeader>
      <div className="card">
        <table className="table">
          <thead><tr><th>Informe</th><th>Contenido</th><th>Descargar</th></tr></thead>
          <tbody>
            <tr className="highlight">
              <td><strong>Informe del año de servicio</strong></td>
              <td>Resumen de cierre del año {sy} (sep–ago): informes, horas, resultado de cada PR, PAI y PA, totales por grupo, detalle mes a mes y altas/bajas. <a href={`/informe-anual?anio=${sy}`}>Ver en pantalla</a></td>
              <td className="nowrap">
                <a className="btn" href={link('anual', 'xlsx')}>Excel</a>{' '}
                <a className="btn-secondary" href={link('anual', 'pdf')}>PDF</a>
              </td>
            </tr>
            <tr>
              <td><strong>Todos los informes</strong></td>
              <td>Un solo archivo con todos los informes del año {sy} (una hoja o sección por informe).</td>
              <td className="nowrap">
                <a className="btn" href={link('todo', 'xlsx')}>Excel</a>{' '}
                <a className="btn-secondary" href={link('todo', 'pdf')}>PDF</a>
              </td>
            </tr>
            {REPORT_KEYS.map((k) => (
              <tr key={k}>
                <td><strong>{REPORTS[k]}</strong></td>
                <td>{DESCRIPTIONS[k]}</td>
                <td className="nowrap">
                  <a className="btn" href={link(k, 'xlsx')}>Excel</a>{' '}
                  <a className="btn-secondary" href={link(k, 'pdf')}>PDF</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Los informes usan los meses cerrados del año de servicio elegido. El directorio de personas siempre muestra el estado actual.</p>
      </div>
    </>
  );
}

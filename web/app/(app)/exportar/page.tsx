import { YearSelect } from '@/components/YearSelect';
import { PageHeader } from '@/components/ui';
import { REPORTS, REPORT_KEYS } from '@/lib/export/tables';
import { yearContext, type SearchParams } from '@/lib/page';

const DESCRIPTIONS: Record<string, string> = {
  cumplimiento: 'Horas, meta, avance y estado de cada PR y PA.',
  completitud: 'Meses informados y con participación por persona (incluye a quienes no son PR ni PA).',
  matriz: 'Una fila por persona y una columna por mes: horas para PR/PA, Sí/No para el resto.',
  mensual: 'Informes recibidos, participación y horas por mes y grupo.',
  personas: 'Listado actual con grupo y cargos.',
};

export default async function ExportarPage({ searchParams }: { searchParams: SearchParams }) {
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

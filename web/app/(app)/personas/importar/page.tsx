import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { canEditEveryone, getSession } from '@/lib/services/session';
import { defaultStartDate } from '@/lib/import/persons';
import { fmtDate } from '@/lib/format';
import { ImportForm } from './ImportForm';

export default async function ImportarPersonasPage() {
  const session = await getSession();
  if (!canEditEveryone(session)) redirect('/personas');
  return (
    <>
      <PageHeader title="Importar personas desde Excel">
        <a className="btn-secondary" href="/api/plantilla-personas">Descargar plantilla</a>
      </PageHeader>
      <div className="card">
        <ol className="steps">
          <li>Descarga la plantilla y llena una fila por persona: nombre, apellidos y, si aplica, grupo, cargos (PR, PAI, PB…), contactos y fecha de nacimiento.</li>
          <li>Sube el archivo y pulsa <strong>Revisar archivo</strong>. Verás cada fila con su estado antes de guardar nada.</li>
          <li>Si no hay errores, pulsa <strong>Importar</strong>. Se guardan todas juntas: si algo falla, no se guarda ninguna.</li>
        </ol>
        <p className="muted small">
          Si no pones fecha, el grupo y los cargos empiezan el {fmtDate(defaultStartDate())} (inicio del año de servicio actual).
          Las personas que ya existen con el mismo nombre y apellidos se omiten.
        </p>
      </div>
      <ImportForm />
    </>
  );
}

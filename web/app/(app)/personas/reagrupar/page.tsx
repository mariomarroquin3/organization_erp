import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Empty, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { listPersons, today } from '@/lib/services/persons';
import { listGroups } from '@/lib/services/catalogs';
import { can, canEditEveryone, getSession } from '@/lib/services/session';
import { param, type SearchParams } from '@/lib/page';
import { reassignAction } from './actions';

export default async function ReagruparPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!canEditEveryone(session)) redirect('/personas');
  const sp = await searchParams;
  const groupId = param(sp, 'grupo') ?? '';
  const db = await createClient();
  const [persons, groups] = await Promise.all([
    listPersons(db, { status: 'activos', groupId: groupId === 'NINGUNO' ? undefined : groupId || undefined }),
    listGroups(db),
  ]);
  const rows = groupId === 'NINGUNO' ? persons.filter((p) => !p.group_id) : persons;
  const active = groups.filter((g) => g.is_active);

  return (
    <>
      <PageHeader title="Reagrupar" />
      <div className="card">
        <p>
          Cambia de grupo a varias personas a la vez, desde una fecha. El grupo anterior se cierra el día antes,
          así que los informes y métricas de los meses pasados siguen contando en el grupo de entonces.
          Para cambiar a una sola persona también puedes hacerlo desde su ficha.
        </p>
        <form className="toolbar" action="/personas/reagrupar">
          <select name="grupo" defaultValue={groupId} aria-label="Mostrar">
            <option value="">Todas las personas activas</option>
            {groups.map((g) => <option key={g.id} value={g.id}>Solo {g.name}{g.is_active ? '' : ' (inactivo)'}</option>)}
            <option value="NINGUNO">Solo sin grupo</option>
          </select>
          <button className="btn-secondary" type="submit">Mostrar</button>
          <span className="muted">{rows.length} persona(s)</span>
        </form>
      </div>

      <ActionForm action={reassignAction} className="card stack" confirm="¿Aplicar los cambios de grupo?">
        <div className="form-grid">
          <label>Fecha del cambio<input type="date" name="fecha" defaultValue={today()} required /></label>
        </div>
        {rows.length === 0 ? <Empty>No hay personas activas con ese filtro.</Empty> : (
          <table className="table">
            <thead><tr><th>Persona</th><th>Grupo actual</th><th>Nuevo grupo</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.person_id}>
                  <td>
                    <Link href={`/personas/${p.person_id}`}>{p.last_name}, {p.first_name}</Link>
                    <input type="hidden" name="person_id" value={p.person_id} />
                    <input type="hidden" name={`cur_${p.person_id}`} value={p.group_id ?? ''} />
                  </td>
                  <td>{p.group_name ?? '—'}</td>
                  <td>
                    <select name={`g_${p.person_id}`} defaultValue={p.group_id ?? ''} aria-label={`Nuevo grupo de ${p.first_name}`}>
                      <option value="">Sin grupo</option>
                      {active.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      {p.group_id && !active.some((g) => g.id === p.group_id)
                        ? <option value={p.group_id}>{p.group_name} (inactivo)</option> : null}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {active.length && can(session, 'CONFIGURACION', 'edit') ? (
          <fieldset className="stack">
            <legend>Grupos que desaparecen (se desactivan al final; deben quedar vacíos)</legend>
            <div className="toolbar">
              {active.map((g) => (
                <label key={g.id} className="inline"><input type="checkbox" name="desactivar" value={g.id} /> {g.name}</label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <p className="muted small">Si una reagrupación crea grupos nuevos, agrégalos primero en Configuración. No renombres un grupo para reutilizarlo: el nombre nuevo aparecería también en los informes pasados.</p>
        <div><SubmitButton>Aplicar cambios</SubmitButton></div>
      </ActionForm>
    </>
  );
}

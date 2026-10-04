import { redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { listGroups } from '@/lib/services/catalogs';
import { today } from '@/lib/services/persons';
import { getSession } from '@/lib/services/session';
import { createPersonAction } from '../actions';
import { PersonFields } from '../PersonFields';

export default async function NuevaPersonaPage() {
  const session = await getSession();
  if (!session?.canEdit) redirect('/personas');
  const groups = await listGroups(await createClient(), { onlyActive: true });
  return (
    <>
      <PageHeader title="Nueva persona" />
      <ActionForm action={createPersonAction} className="card stack">
        <PersonFields />
        <div className="form-grid">
          <label>Grupo (opcional)
            <select name="group_id" defaultValue="">
              <option value="">Sin grupo</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label>En el grupo desde<input type="date" name="group_start" defaultValue={today()} /></label>
        </div>
        <p className="muted">Los cargos (PR, PA, …) se agregan desde la ficha, con su fecha de inicio.</p>
        <div><SubmitButton>Crear persona</SubmitButton></div>
      </ActionForm>
    </>
  );
}

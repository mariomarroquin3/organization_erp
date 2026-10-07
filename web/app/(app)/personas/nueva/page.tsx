import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { listGroups, listMovementTypes } from '@/lib/services/catalogs';
import { today } from '@/lib/services/persons';
import { requireAreaPage } from '@/lib/services/session';
import { createPersonAction } from '../actions';
import { PersonFields } from '../PersonFields';

export default async function NuevaPersonaPage() {
  const session = await requireAreaPage('PERSONAS', 'edit');
  const db = await createClient();
  const [groups, types] = await Promise.all([listGroups(db, { onlyActive: true }), listMovementTypes(db, { onlyActive: true })]);
  const altas = types.filter((t) => t.direction === 'ALTA');
  // Un encargado solo crea personas en sus grupos (si no, no las vería)
  const scoped = !session.allGroups;
  const options = scoped ? groups.filter((g) => session.groups.some((s) => s.id === g.id)) : groups;
  return (
    <>
      <PageHeader title="Nueva persona" />
      <ActionForm action={createPersonAction} className="card stack">
        <PersonFields />
        <div className="form-grid">
          <label>Grupo{scoped ? '' : ' (opcional)'}
            <select name="group_id" defaultValue="" required={scoped}>
              <option value="" disabled={scoped}>{scoped ? 'Elige…' : 'Sin grupo'}</option>
              {options.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label>En el grupo desde<input type="date" name="group_start" defaultValue={today()} /></label>
        </div>
        <div className="form-grid">
          <label>Motivo de alta
            <select name="alta_type_id" defaultValue="">
              <option value="">Ya era miembro (sin fecha de alta)</option>
              {altas.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>Fecha de alta<input type="date" name="alta_date" defaultValue={today()} max={today()} /></label>
          <label className="span-2">Congregación de origen (si viene por traslado)<input name="alta_congregation" /></label>
        </div>
        <p className="muted">Los cargos (PR, PAI, PA, …) se agregan desde la ficha, con su fecha de inicio.</p>
        <div><SubmitButton>Crear persona</SubmitButton></div>
      </ActionForm>
    </>
  );
}

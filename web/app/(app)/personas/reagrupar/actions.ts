'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { can, canEditEveryone, requireSession } from '@/lib/services/session';
import { reassignGroups, type GroupMove } from '@/lib/services/persons';
import { ServiceError } from '@/lib/services/errors';
import { required, runAction, str, type ActionState } from '@/lib/action';

export async function reassignAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const session = await requireSession();
    if (!canEditEveryone(session)) throw new ServiceError('Reagrupar requiere editar Personas de todos los grupos.');
    const date = required(fd, 'fecha', 'la fecha del cambio');
    const moves: GroupMove[] = [];
    for (const id of fd.getAll('person_id').map(String)) {
      const next = str(fd, `g_${id}`);
      if (next !== str(fd, `cur_${id}`)) moves.push({ person_id: id, group_id: next || null });
    }
    const deactivate = fd.getAll('desactivar').map(String);
    if (deactivate.length && !can(session, 'CONFIGURACION', 'edit')) {
      throw new ServiceError('Desactivar grupos requiere permiso de edición en Configuración.');
    }
    if (!moves.length && !deactivate.length) throw new ServiceError('No cambiaste ningún grupo.');
    const n = await reassignGroups(await createClient(), date, moves, deactivate);
    revalidatePath('/', 'layout');
    return `Listo: ${n} persona(s) cambiaron de grupo${deactivate.length ? ` y se desactivaron ${deactivate.length} grupo(s)` : ''}.`;
  });
}

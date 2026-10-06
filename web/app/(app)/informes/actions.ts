'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireArea } from '@/lib/services/session';
import { saveMonthSheet } from '@/lib/services/reports';
import type { ReportState, SheetEntry } from '@/lib/services/report-plan';
import { runAction, type ActionState } from '@/lib/action';
import { parsePeriodKey } from '@/lib/service-year';

export async function saveSheetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireArea('INFORMES');
    const ym = parsePeriodKey(String(fd.get('mes')));
    if (!ym) throw new Error('Mes no válido.');
    const entries: SheetEntry[] = fd.getAll('person_id').map((id) => {
      const pid = String(id);
      const state = String(fd.get(`state_${pid}`) ?? '') as ReportState;
      return { person_id: pid, state: ['si', 'no'].includes(state) ? state : '', hours: String(fd.get(`hours_${pid}`) ?? ''),
        studies: String(fd.get(`studies_${pid}`) ?? '') };
    });
    const db = await createClient();
    const res = await saveMonthSheet(db, ym, entries);
    if (res.errors.length) {
      return { ok: false, message: 'No se guardó nada. Corrige estos renglones:', errors: res.errors };
    }
    revalidatePath('/', 'layout');
    if (!res.saved && !res.deleted) return 'No había cambios que guardar.';
    return `Guardado: ${res.saved} informe(s) actualizados${res.deleted ? `, ${res.deleted} eliminado(s)` : ''}.`;
  });
}

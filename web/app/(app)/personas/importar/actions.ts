'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireEditor } from '@/lib/services/session';
import { checkImport, runImport } from '@/lib/services/import';
import { ServiceError } from '@/lib/services/errors';
import type { PreviewRow, RowStatus } from '@/lib/import/persons';

export interface ImportState {
  ok: boolean;
  message: string;
  fileErrors: string[];
  rows: PreviewRow[];
  counts: Record<RowStatus, number> | null;
  imported?: number;
  at?: number;
}

async function fileFrom(fd: FormData): Promise<ArrayBuffer> {
  const f = fd.get('archivo');
  if (!(f instanceof File) || f.size === 0) throw new ServiceError('Elige el archivo de Excel.');
  if (f.size > 4 * 1024 * 1024) throw new ServiceError('El archivo pesa más de 4 MB.');
  return f.arrayBuffer();
}

/** paso=revisar: solo valida. paso=importar: valida de nuevo y guarda. */
export async function importAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const base: ImportState = { ok: false, message: '', fileErrors: [], rows: [], counts: null, at: Date.now() };
  try {
    await requireEditor();
    const db = await createClient();
    const result = await checkImport(db, await fileFrom(fd));
    const view = { ...base, fileErrors: result.fileErrors, rows: result.rows, counts: result.counts };
    if (result.fileErrors.length) return { ...view, message: 'No se pudo usar el archivo.' };
    if (fd.get('paso') !== 'importar') {
      const ok = result.counts.error === 0 && result.counts.ok > 0;
      return { ...view, ok, message: ok
        ? `Listo para importar ${result.counts.ok} persona(s).`
        : result.counts.error ? `Hay ${result.counts.error} fila(s) con errores. Corrígelas en el Excel y vuelve a subirlo.`
        : 'No hay personas nuevas en el archivo.' };
    }
    const n = await runImport(db, result);
    revalidatePath('/', 'layout');
    return { ...view, ok: true, imported: n, message: `Se importaron ${n} persona(s).` };
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    return { ...base, message: e instanceof Error ? e.message : 'Error inesperado.' };
  }
}

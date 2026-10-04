import type { Db } from '@/lib/supabase/server';
import { readWorkbook, validateRows, type ImportCatalogs, type ImportCheck } from '@/lib/import/persons';
import { listContactTypes, listGroups, listMovementTypes, listRoles } from './catalogs';
import { check, ServiceError } from './errors';

export async function importCatalogs(db: Db): Promise<ImportCatalogs> {
  const [groups, roles, contactTypes, movementTypes] = await Promise.all([
    listGroups(db), listRoles(db), listContactTypes(db), listMovementTypes(db),
  ]);
  return { groups, roles, contactTypes, movementTypes };
}

/** Lee y valida el Excel contra los catálogos y las personas que ya existen. */
export async function checkImport(db: Db, file: ArrayBuffer): Promise<ImportCheck> {
  const read = await readWorkbook(file);
  if (read.errors.length) return { rows: [], payload: [], counts: { ok: 0, error: 0, skip: 0 }, fileErrors: read.errors };
  const [cat, persons] = await Promise.all([
    importCatalogs(db),
    db.from('persons').select('first_name, last_name'),
  ]);
  const existing = (check(persons) as { first_name: string; last_name: string }[]).map((p) => `${p.first_name} ${p.last_name}`);
  return { ...validateRows(read.rows, cat, existing), fileErrors: [] };
}

/** Guarda todo en una transacción (fn_import_persons): o entran todas o ninguna. */
export async function runImport(db: Db, result: ImportCheck): Promise<number> {
  if (result.fileErrors.length || result.counts.error) throw new ServiceError('Corrige los errores antes de importar.');
  if (!result.payload.length) throw new ServiceError('No hay personas nuevas que importar.');
  return check(await db.rpc('fn_import_persons', { p_rows: result.payload })) as number;
}

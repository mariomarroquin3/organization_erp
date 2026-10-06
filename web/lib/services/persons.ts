import type { Db } from '@/lib/supabase/server';
import type {
  Person, PersonOverview, RoleHistoryRow, GroupHistoryRow, PersonContact, PersonDate, MonthlyReport, PersonMovement,
} from '@/lib/types';
import { check, fetchAll, ServiceError } from './errors';
import { addMovement, listMovements } from './movements';

export interface PersonFilters {
  q?: string;
  groupId?: string;
  role?: string;          // código de cargo actual, o 'NINGUNO'
  status?: 'activos' | 'inactivos' | 'todos';
}

export async function listPersons(db: Db, f: PersonFilters = {}) {
  const status = f.status ?? 'activos';
  let rows = await fetchAll<PersonOverview>((from, to) => {
    let q = db.from('view_persons_overview').select('*').order('last_name').order('first_name').order('person_id');
    if (status !== 'todos') q = q.eq('is_active', status === 'activos');
    if (f.groupId) q = q.eq('group_id', f.groupId);
    return q.range(from, to);
  });

  // Filtros de texto y cargo en memoria: la lista es de decenas o pocos
  // cientos de personas y así se evita escapar patrones en PostgREST.
  if (f.q) {
    const needle = normalize(f.q);
    rows = rows.filter((p) => normalize(`${p.first_name} ${p.last_name}`).includes(needle));
  }
  if (f.role === 'NINGUNO') rows = rows.filter((p) => !p.current_roles);
  else if (f.role) rows = rows.filter((p) => (p.current_roles ?? '').split(', ').includes(f.role!));
  return rows;
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

export async function getPerson(db: Db, id: string) {
  const p = check(await db.from('persons')
    .select('id, first_name, last_name, birth_date, is_active, notes').eq('id', id).maybeSingle()) as Person | null;
  if (!p) throw new ServiceError('La persona no existe.');
  return p;
}

export async function getPersonDetail(db: Db, id: string, serviceYear: number) {
  const [person, roles, groups, contacts, dates, reports, movements] = await Promise.all([
    getPerson(db, id),
    db.from('view_role_history').select('*').eq('person_id', id).order('start_date', { ascending: false }),
    db.from('person_group_history').select('id, person_id, group_id, start_date, end_date, catalog_groups(name)')
      .eq('person_id', id).order('start_date', { ascending: false }),
    db.from('person_contacts').select('id, person_id, contact_type_id, value, is_primary, catalog_contact_types(name)')
      .eq('person_id', id).order('is_primary', { ascending: false }),
    db.from('person_dates').select('id, person_id, date_type_id, date_value, catalog_date_types(name)')
      .eq('person_id', id).order('date_value'),
    db.from('monthly_reports').select('id, person_id, year, month, participated, hours, bible_studies, notes, service_year')
      .eq('person_id', id).eq('service_year', serviceYear).order('year').order('month'),
    listMovements(db, { personId: id }),
  ]);
  return {
    person,
    roles: check(roles) as RoleHistoryRow[],
    groups: check(groups) as unknown as GroupHistoryRow[],
    contacts: check(contacts) as unknown as PersonContact[],
    dates: check(dates) as unknown as PersonDate[],
    reports: check(reports) as MonthlyReport[],
    movements: movements as PersonMovement[],
  };
}

// is_active no se edita: lo mantienen las altas y bajas (migración 0800)
export interface PersonInput {
  first_name: string; last_name: string; birth_date: string | null; notes: string | null;
}

export interface AltaInput { movement_type_id: string; movement_date: string; congregation: string | null }

export async function createPerson(db: Db, input: PersonInput & {
  group_id?: string | null; start_date?: string; alta?: AltaInput | null;
}) {
  const { group_id, start_date, alta, ...row } = input;
  if (alta) {
    // Validar antes de crear, para no dejar a la persona creada sin su alta
    const t = check(await db.from('catalog_movement_types').select('name, direction, requires_congregation')
      .eq('id', alta.movement_type_id).maybeSingle()) as { name: string; direction: string; requires_congregation: boolean } | null;
    if (!t || t.direction !== 'ALTA') throw new ServiceError('Elige un motivo de alta válido.');
    if (t.requires_congregation && !alta.congregation) throw new ServiceError(`Para "${t.name}" indica la congregación de origen.`);
    if (alta.movement_date > today()) throw new ServiceError('La fecha de alta no puede ser futura.');
  }
  // El id se genera aquí: un encargado de grupo aún no puede leer a la
  // persona (RLS) hasta que tenga grupo, así que no se pide de vuelta.
  // Primero el grupo y luego el alta, por la misma razón.
  const id = crypto.randomUUID();
  check(await db.from('persons').insert({ id, ...row }));
  if (group_id) {
    await addGroupPeriod(db, { person_id: id, group_id, start_date: start_date ?? today(), end_date: null });
  }
  if (alta) await addMovement(db, { person_id: id, ...alta, notes: null });
  return id;
}

export async function updatePerson(db: Db, id: string, input: PersonInput) {
  check(await db.from('persons').update(input).eq('id', id));
}

export async function deletePerson(db: Db, id: string) {
  check(await db.from('persons').delete().eq('id', id));
}

// ---- Cargos ----------------------------------------------------------

export async function addRolePeriod(db: Db, r: { person_id: string; role_id: string; start_date: string; end_date: string | null; notes?: string | null }) {
  check(await db.from('person_roles').insert(r));
}

export async function closeRolePeriod(db: Db, id: string, end_date: string) {
  check(await db.from('person_roles').update({ end_date }).eq('id', id));
}

export async function deleteRolePeriod(db: Db, id: string) {
  check(await db.from('person_roles').delete().eq('id', id));
}

// ---- Grupos ----------------------------------------------------------

/**
 * Asigna un grupo desde una fecha. Si la persona tiene un grupo abierto
 * que empezó antes, se cierra el día anterior (cambio de grupo).
 */
export async function addGroupPeriod(db: Db, g: { person_id: string; group_id: string; start_date: string; end_date: string | null }) {
  const open = check(await db.from('person_group_history').select('id, start_date')
    .eq('person_id', g.person_id).is('end_date', null)) as { id: string; start_date: string }[];
  for (const o of open) {
    if (o.start_date < g.start_date) {
      check(await db.from('person_group_history').update({ end_date: dayBefore(g.start_date) }).eq('id', o.id));
    }
  }
  check(await db.from('person_group_history').insert(g));
}

export async function closeGroupPeriod(db: Db, id: string, end_date: string) {
  check(await db.from('person_group_history').update({ end_date }).eq('id', id));
}

export async function deleteGroupPeriod(db: Db, id: string) {
  check(await db.from('person_group_history').delete().eq('id', id));
}

// ---- Contactos y fechas ------------------------------------------------

export async function addContact(db: Db, c: { person_id: string; contact_type_id: string; value: string; is_primary: boolean }) {
  check(await db.from('person_contacts').insert(c));
}

export async function deleteContact(db: Db, id: string) {
  check(await db.from('person_contacts').delete().eq('id', id));
}

export async function setDate(db: Db, d: { person_id: string; date_type_id: string; date_value: string }) {
  check(await db.from('person_dates').upsert(d, { onConflict: 'person_id,date_type_id' }));
}

export async function deleteDate(db: Db, id: string) {
  check(await db.from('person_dates').delete().eq('id', id));
}

// ---- utilidades --------------------------------------------------------

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---- Reagrupación ------------------------------------------------------

export interface GroupMove { person_id: string; group_id: string | null }

/**
 * Cambia de grupo a varias personas desde una fecha, en una transacción
 * (fn_reassign_groups, migración 1000). Los periodos anteriores se cierran
 * el día antes: los meses pasados conservan su grupo.
 */
export async function reassignGroups(db: Db, date: string, moves: GroupMove[], deactivate: string[] = []) {
  return check(await db.rpc('fn_reassign_groups', { p_date: date, p_moves: moves, p_deactivate: deactivate })) as number;
}

import type { Db } from '@/lib/supabase/server';
import type { MembershipPeriod, MovementDirection, MovementType, PersonMovement } from '@/lib/types';
import { check, fetchAll } from './errors';

// Altas, bajas y traslados (migración 0800). La base valida que se
// alternen, cierra cargos y grupo al dar de baja y mantiene
// persons.is_active; aquí solo se leen y se escriben los registros.

export async function listMovements(db: Db, f: { serviceYear?: number; personId?: string } = {}) {
  let q = db.from('view_person_movements').select('*').order('movement_date', { ascending: false });
  if (f.serviceYear) q = q.eq('service_year', f.serviceYear);
  if (f.personId) q = q.eq('person_id', f.personId);
  return check(await q) as PersonMovement[];
}

export interface MovementInput {
  person_id: string; movement_type_id: string; movement_date: string;
  congregation: string | null; notes: string | null;
}

export async function addMovement(db: Db, m: MovementInput) {
  check(await db.from('person_movements').insert(m));
}

export async function deleteMovement(db: Db, id: string) {
  check(await db.from('person_movements').delete().eq('id', id));
}

export async function listMembershipPeriods(db: Db) {
  return fetchAll<MembershipPeriod>((from, to) => db.from('view_membership_periods')
    .select('person_id, start_date, end_date').order('person_id').order('start_date').range(from, to));
}

/** ¿Era miembro al menos un día entre from y to (fechas ISO inclusivas)? */
export function wasMemberDuring(periods: MembershipPeriod[], from: string, to: string): boolean {
  return periods.some((p) => (p.start_date === null || p.start_date <= to) && (p.end_date === null || p.end_date >= from));
}

/** Tipos que se pueden registrar ahora: bajas si está activa, altas si no. */
export function allowedMovementTypes(types: MovementType[], isActive: boolean): MovementType[] {
  const want: MovementDirection = isActive ? 'BAJA' : 'ALTA';
  return types.filter((t) => t.direction === want);
}

export interface MovementTotals {
  altas: number; bajas: number; trasladosEntrada: number; trasladosSalida: number;
  byType: { name: string; direction: MovementDirection; count: number }[];
}

export function summarizeMovements(rows: PersonMovement[]): MovementTotals {
  const byType = new Map<string, { name: string; direction: MovementDirection; count: number }>();
  let altas = 0, bajas = 0, trasladosEntrada = 0, trasladosSalida = 0;
  for (const r of rows) {
    if (r.direction === 'ALTA') altas += 1; else bajas += 1;
    if (r.type_code === 'TRASLADO_ENTRADA') trasladosEntrada += 1;
    if (r.type_code === 'TRASLADO_SALIDA') trasladosSalida += 1;
    const t = byType.get(r.type_code) ?? { name: r.type_name, direction: r.direction, count: 0 };
    t.count += 1;
    byType.set(r.type_code, t);
  }
  return {
    altas, bajas, trasladosEntrada, trasladosSalida,
    byType: [...byType.values()].sort((a, b) => a.direction.localeCompare(b.direction) || b.count - a.count),
  };
}

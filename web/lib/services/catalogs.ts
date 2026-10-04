import type { Db } from '@/lib/supabase/server';
import type { CatalogGroup, CatalogRole, CatalogType, MovementType, RoleHourGoal, AppUser } from '@/lib/types';
import { check } from './errors';

export async function listGroups(db: Db, { onlyActive = false } = {}) {
  let q = db.from('catalog_groups').select('id, name, description, is_active').order('name');
  if (onlyActive) q = q.eq('is_active', true);
  return check(await q) as CatalogGroup[];
}

export async function listRoles(db: Db, { onlyActive = false } = {}) {
  let q = db.from('catalog_roles')
    .select('id, code, name, requires_hours_report, is_active, sort_order')
    .order('sort_order').order('code');
  if (onlyActive) q = q.eq('is_active', true);
  return check(await q) as CatalogRole[];
}

export async function listContactTypes(db: Db) {
  return check(await db.from('catalog_contact_types').select('id, code, name').order('name')) as CatalogType[];
}

export async function listDateTypes(db: Db) {
  return check(await db.from('catalog_date_types').select('id, code, name').order('name')) as CatalogType[];
}

export async function listMovementTypes(db: Db, { onlyActive = false } = {}) {
  let q = db.from('catalog_movement_types')
    .select('id, code, name, direction, requires_congregation, is_active, sort_order')
    .order('sort_order').order('name');
  if (onlyActive) q = q.eq('is_active', true);
  return check(await q) as MovementType[];
}

export async function saveGroup(db: Db, g: { id?: string; name: string; description?: string | null; is_active?: boolean }) {
  const row = { name: g.name.trim(), description: g.description?.trim() || null, is_active: g.is_active ?? true };
  if (g.id) check(await db.from('catalog_groups').update(row).eq('id', g.id));
  else check(await db.from('catalog_groups').insert(row));
}

export async function saveRole(db: Db, r: {
  id?: string; code: string; name: string; requires_hours_report: boolean; is_active: boolean; sort_order: number;
}) {
  const row = {
    code: r.code.trim().toUpperCase(), name: r.name.trim(),
    requires_hours_report: r.requires_hours_report, is_active: r.is_active, sort_order: r.sort_order,
  };
  if (r.id) check(await db.from('catalog_roles').update(row).eq('id', r.id));
  else check(await db.from('catalog_roles').insert(row));
}

export async function listGoals(db: Db) {
  return check(await db.from('role_hour_goals')
    .select('id, role_id, effective_from_sy, annual_hours, monthly_hours, notes, catalog_roles(code, name)')
    .order('effective_from_sy', { ascending: false })) as unknown as RoleHourGoal[];
}

export async function saveGoal(db: Db, g: {
  id?: string; role_id: string; effective_from_sy: number;
  annual_hours: number | null; monthly_hours: number | null; notes: string | null;
}) {
  const row = {
    role_id: g.role_id, effective_from_sy: g.effective_from_sy,
    annual_hours: g.annual_hours, monthly_hours: g.monthly_hours, notes: g.notes,
  };
  if (g.id) check(await db.from('role_hour_goals').update(row).eq('id', g.id));
  else check(await db.from('role_hour_goals').insert(row));
}

export async function deleteGoal(db: Db, id: string) {
  check(await db.from('role_hour_goals').delete().eq('id', id));
}

export async function listAppUsers(db: Db) {
  return check(await db.from('app_users')
    .select('id, person_id, display_name, is_active, system_role_id, catalog_system_roles(code, name)')
    .order('display_name')) as unknown as AppUser[];
}

export async function listSystemRoles(db: Db) {
  return check(await db.from('catalog_system_roles').select('id, code, name').order('code')) as CatalogType[];
}

export async function updateAppUser(db: Db, id: string, patch: { system_role_id: string; is_active: boolean }) {
  check(await db.from('app_users').update(patch).eq('id', id));
}

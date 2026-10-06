import 'server-only';
import type { Db } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { cleanAreaMap, isArea, type Area, type AreaMap, type Level } from '@/lib/permissions';
import { check, ServiceError } from './errors';

export interface UserAccess {
  superadmin: boolean;
  allGroups: boolean;
  groupIds: string[];
  areas: AreaMap;
}

export interface UserRow extends UserAccess {
  id: string;
  displayName: string | null;
  email: string | null;
  isActive: boolean;
  groupNames: string[];
}

export interface Template {
  id: string; name: string; description: string | null; areas: AreaMap; group_scoped: boolean; sort_order: number;
}

interface DbUser {
  id: string; display_name: string | null; is_active: boolean; all_groups: boolean;
  catalog_system_roles: { code: string } | null;
  app_user_permissions: { area: string; can_edit: boolean }[];
  app_user_groups: { group_id: string; catalog_groups: { name: string } | null }[];
}

export async function listUsers(db: Db): Promise<UserRow[]> {
  const rows = check(await db.from('app_users')
    .select('id, display_name, is_active, all_groups, catalog_system_roles(code), app_user_permissions(area, can_edit), app_user_groups(group_id, catalog_groups(name))')
    .order('display_name')) as unknown as DbUser[];
  const emails = await authEmails();
  return rows.map((u) => {
    const areas: AreaMap = {};
    for (const p of u.app_user_permissions) if (isArea(p.area)) areas[p.area] = p.can_edit ? 'edit' : 'read';
    return {
      id: u.id,
      displayName: u.display_name,
      email: emails.get(u.id) ?? null,
      isActive: u.is_active,
      superadmin: u.catalog_system_roles?.code === 'SUPERADMIN',
      allGroups: u.all_groups,
      groupIds: u.app_user_groups.map((g) => g.group_id),
      groupNames: u.app_user_groups.map((g) => g.catalog_groups?.name ?? '?').sort(),
      areas,
    };
  });
}

/** Correos de Supabase Auth (solo con la service_role key configurada). */
async function authEmails(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!hasServiceRole()) return out;
  const admin = createAdminClient();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return out;
    for (const u of data.users) if (u.email) out.set(u.id, u.email);
    if (data.users.length < 1000) return out;
  }
}

async function findAuthUser(email: string) {
  const admin = createAdminClient();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new ServiceError(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
}

export async function saveAccess(db: Db, id: string, displayName: string | null, isActive: boolean, a: UserAccess) {
  check(await db.rpc('fn_save_app_user', {
    p_user_id: id, p_display_name: displayName, p_superadmin: a.superadmin, p_is_active: isActive,
    p_all_groups: a.allGroups, p_group_ids: a.groupIds, p_areas: a.areas,
  }));
}

/**
 * Crea el usuario en Supabase Auth y su cuenta con permisos. Si el correo
 * ya existía en Auth pero no tenía cuenta en la app (creado a mano en
 * Supabase), se reutiliza. Si guardar los permisos falla, el usuario
 * recién creado se borra para no dejarlo a medias.
 */
export async function createUser(db: Db, input: {
  email: string; password: string; displayName: string | null; access: UserAccess;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email, password: input.password, email_confirm: true,
  });
  let id = data.user?.id;
  let created = true;
  if (error) {
    if (!/already|registered|exists/i.test(error.message)) throw new ServiceError(error.message);
    const existing = await findAuthUser(input.email);
    if (!existing) throw new ServiceError(error.message);
    const { data: has } = await db.from('app_users').select('id').eq('id', existing.id).maybeSingle();
    if (has) throw new ServiceError('Ya existe una cuenta con ese correo.');
    id = existing.id;
    created = false;
  }
  if (!id) throw new ServiceError('No se pudo crear el usuario.');
  try {
    await saveAccess(db, id, input.displayName, true, input.access);
  } catch (e) {
    if (created) await admin.auth.admin.deleteUser(id);
    throw e;
  }
  return { id, reused: !created };
}

export async function setPassword(id: string, password: string) {
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
  if (error) throw new ServiceError(error.message);
}

export async function setArea(db: Db, userId: string, area: Area, level: Level | null) {
  check(await db.rpc('fn_set_user_area', { p_user_id: userId, p_area: area, p_level: level }));
}

// ---- Plantillas ----------------------------------------------------------

export async function listTemplates(db: Db): Promise<Template[]> {
  const rows = check(await db.from('permission_templates')
    .select('id, name, description, areas, group_scoped, sort_order').order('sort_order').order('name')) as Template[];
  return rows.map((t) => ({ ...t, areas: cleanAreaMap(t.areas) }));
}

export async function saveTemplate(db: Db, t: { id?: string; name: string; description: string | null; areas: AreaMap; group_scoped: boolean }) {
  const row = { name: t.name.trim(), description: t.description, areas: t.areas, group_scoped: t.group_scoped };
  if (t.id) check(await db.from('permission_templates').update(row).eq('id', t.id));
  else check(await db.from('permission_templates').insert(row));
}

export async function deleteTemplate(db: Db, id: string) {
  check(await db.from('permission_templates').delete().eq('id', id));
}

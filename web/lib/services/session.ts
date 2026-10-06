import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { allows, cleanAreaMap, type Area, type AreaMap, type Level } from '@/lib/permissions';
import type { SystemRole } from '@/lib/types';
import { ServiceError } from './errors';

export interface Session {
  userId: string;
  email: string | null;
  role: SystemRole | null; // null: autenticado pero sin cuenta activa en app_users
  isSuperadmin: boolean;
  areas: AreaMap;
  allGroups: boolean;      // false: solo ve a las personas de `groups`
  groups: { id: string; name: string }[];
}

interface Access {
  role: SystemRole; superadmin: boolean; all_groups: boolean;
  groups: { id: string; name: string }[]; areas: Record<string, string>;
}

export const getSession = cache(async (): Promise<Session | null> => {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.rpc('fn_my_access');
  const a = (data ?? null) as Access | null;
  return {
    userId: user.id,
    email: user.email ?? null,
    role: a?.role ?? null,
    isSuperadmin: !!a?.superadmin,
    areas: cleanAreaMap(a?.areas),
    allGroups: a?.all_groups ?? false,
    groups: a?.groups ?? [],
  };
});

export function can(s: Session | null, area: Area, need: Level = 'read') {
  return !!s && allows(s.areas, area, need);
}

/** Edita a cualquier persona: importar y reagrupar (la base exige lo mismo). */
export function canEditEveryone(s: Session | null) {
  return can(s, 'PERSONAS', 'edit') && !!s?.allGroups;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

/** Para páginas: sin acceso al área vuelve al inicio. */
export async function requireAreaPage(area: Area, need: Level = 'read'): Promise<Session> {
  const s = await requireSession();
  if (!can(s, area, need)) redirect('/');
  return s;
}

/** Para acciones que escriben. El RLS lo vuelve a comprobar en la base. */
export async function requireArea(area: Area, need: Level = 'edit'): Promise<Session> {
  const s = await requireSession();
  if (!can(s, area, need)) throw new ServiceError('Tu cuenta no tiene permiso para esto.');
  return s;
}

export async function requireSuperadmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.isSuperadmin) throw new ServiceError('Solo un super administrador gestiona cuentas.');
  return s;
}

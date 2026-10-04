import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { SystemRole } from '@/lib/types';

export interface Session {
  userId: string;
  email: string | null;
  role: SystemRole | null; // null: autenticado pero sin cuenta activa en app_users
  canEdit: boolean;
  isSuperadmin: boolean;
}

export const getSession = cache(async (): Promise<Session | null> => {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: role } = await db.rpc('auth_system_role_code');
  const r = (role ?? null) as SystemRole | null;
  return {
    userId: user.id,
    email: user.email ?? null,
    role: r,
    canEdit: r === 'ADMIN' || r === 'SUPERADMIN',
    isSuperadmin: r === 'SUPERADMIN',
  };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

/** Para acciones que escriben. El RLS lo vuelve a comprobar en la base. */
export async function requireEditor(): Promise<Session> {
  const s = await requireSession();
  if (!s.canEdit) throw new Error('Tu cuenta es de solo lectura.');
  return s;
}

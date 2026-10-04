'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/lib/action';

export async function signIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '').trim();
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { ok: false, message: 'Escribe tu correo y contraseña.' };
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: 'Correo o contraseña incorrectos.' };
  redirect('/');
}

export async function signOut() {
  const db = await createClient();
  await db.auth.signOut();
  redirect('/login');
}

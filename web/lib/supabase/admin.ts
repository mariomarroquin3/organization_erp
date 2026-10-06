import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { ServiceError } from '@/lib/services/errors';
import { supabaseEnv } from './env';

// Cliente con la service_role key: SOLO para Supabase Auth (crear
// usuarios, ver correos, cambiar contraseñas). Se salta el RLS, así que
// nunca se usa para leer o escribir datos; eso va con la sesión del
// usuario. La variable no lleva NEXT_PUBLIC_: nunca llega al navegador.
export function hasServiceRole() {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new ServiceError('Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (ver README) para crear usuarios desde la app.');
  }
  return createClient(supabaseEnv().url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

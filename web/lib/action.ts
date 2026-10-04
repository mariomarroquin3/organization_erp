import { ServiceError } from '@/lib/services/errors';

export interface ActionState { ok: boolean; message: string; errors?: string[]; at?: number }
export const initialState: ActionState = { ok: true, message: '' };

/** Envuelve una acción de servidor: convierte excepciones en mensaje. */
export async function runAction(fn: () => Promise<string | ActionState>): Promise<ActionState> {
  try {
    const r = await fn();
    return typeof r === 'string' ? { ok: true, message: r, at: Date.now() } : { ...r, at: Date.now() };
  } catch (e) {
    // redirect()/notFound() de Next se propagan
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    const message = e instanceof ServiceError || e instanceof Error ? e.message : 'Error inesperado.';
    return { ok: false, message, at: Date.now() };
  }
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

export function optStr(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

export function required(fd: FormData, key: string, label: string): string {
  const v = str(fd, key);
  if (!v) throw new ServiceError(`Falta ${label}.`);
  return v;
}

export function optNum(fd: FormData, key: string, label: string): number | null {
  const v = str(fd, key).replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ServiceError(`${label} debe ser un número.`);
  return n;
}

import type { PostgrestError } from '@supabase/supabase-js';

export class ServiceError extends Error {}

// Traduce los errores de Postgres a mensajes que Javier entienda. Los
// triggers de la base ya devuelven mensajes en español; aquí solo se
// cubren las restricciones genéricas.
export function friendlyDbError(err: PostgrestError | null | undefined): string {
  if (!err) return 'Error desconocido.';
  const m = err.message ?? '';
  if (err.code === '42501' || /row-level security|permission denied/i.test(m)) {
    return 'No tienes permiso para hacer este cambio.';
  }
  if (/ex_pgh_no_overlap/.test(m)) return 'Ese periodo se solapa con otro grupo de la persona.';
  if (/ex_pr_same_role_no_overlap/.test(m)) return 'La persona ya tiene ese cargo en un periodo que se solapa.';
  if (/chk_hours_implies_participation/.test(m)) return 'Si informó horas, debe marcarse que participó.';
  if (/chk_(group|role)_dates/.test(m)) return 'La fecha de fin no puede ser anterior a la de inicio.';
  if (/uq_role_goal_year/.test(m)) return 'Ese cargo ya tiene una meta desde ese año de servicio.';
  if (err.code === '23505') return 'Ya existe un registro con esos datos.';
  if (err.code === '23503') return 'El registro está en uso y no se puede borrar.';
  return m;
}

export function check<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw new ServiceError(friendlyDbError(res.error));
  return res.data as T;
}

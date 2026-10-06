'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireArea } from '@/lib/services/session';
import * as cat from '@/lib/services/catalogs';
import { ServiceError } from '@/lib/services/errors';
import { optNum, optStr, required, runAction, type ActionState } from '@/lib/action';

async function editor() {
  await requireArea('CONFIGURACION');
  return createClient();
}

function done(msg: string) {
  revalidatePath('/', 'layout');
  return msg;
}

export async function saveGroupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await cat.saveGroup(await editor(), {
      id: optStr(fd, 'id') ?? undefined,
      name: required(fd, 'name', 'el nombre'),
      description: optStr(fd, 'description'),
      is_active: fd.has('id') ? fd.get('is_active') === 'on' : true,
    });
    return done('Grupo guardado.');
  });
}

export async function saveRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await cat.saveRole(await editor(), {
      id: optStr(fd, 'id') ?? undefined,
      code: required(fd, 'code', 'el código'),
      name: required(fd, 'name', 'el nombre'),
      requires_hours_report: fd.get('requires_hours_report') === 'on',
      is_active: fd.has('id') ? fd.get('is_active') === 'on' : true,
      sort_order: optNum(fd, 'sort_order', 'El orden') ?? 100,
    });
    return done('Cargo guardado.');
  });
}

export async function saveGoalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const annual = optNum(fd, 'annual_hours', 'La meta anual');
    const monthly = optNum(fd, 'monthly_hours', 'La meta mensual');
    if (annual === null && monthly === null) throw new ServiceError('Indica la meta anual o la mensual.');
    const sy = optNum(fd, 'effective_from_sy', 'El año de servicio');
    if (!sy || !Number.isInteger(sy)) throw new ServiceError('Indica desde qué año de servicio aplica.');
    await cat.saveGoal(await editor(), {
      id: optStr(fd, 'id') ?? undefined,
      role_id: required(fd, 'role_id', 'el cargo'),
      effective_from_sy: sy,
      annual_hours: annual,
      monthly_hours: monthly,
      notes: optStr(fd, 'notes'),
    });
    return done('Meta guardada.');
  });
}

export async function deleteGoalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await cat.deleteGoal(await editor(), required(fd, 'id', 'la meta'));
    return done('Meta eliminada.');
  });
}

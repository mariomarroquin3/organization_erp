'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSuperadmin } from '@/lib/services/session';
import * as users from '@/lib/services/users';
import { ServiceError } from '@/lib/services/errors';
import { AREAS, AREA_INFO, isArea, type AreaMap, type Level } from '@/lib/permissions';
import { optStr, required, runAction, str, type ActionState } from '@/lib/action';

/** Lee la matriz de permisos (campos area_PERSONAS = '' | 'read' | 'edit'). */
function areasFrom(fd: FormData): AreaMap {
  const out: AreaMap = {};
  for (const a of AREAS) {
    const v = str(fd, `area_${a}`);
    if (v === 'read' || v === 'edit') out[a] = v === 'edit' && AREA_INFO[a].editable ? 'edit' : 'read';
  }
  return out;
}

function accessFrom(fd: FormData): users.UserAccess {
  const superadmin = fd.get('superadmin') === 'on';
  const allGroups = superadmin || str(fd, 'scope') !== 'groups';
  const groupIds = allGroups ? [] : fd.getAll('group_ids').map(String);
  if (!allGroups && groupIds.length === 0) throw new ServiceError('Elige al menos un grupo o marca "Todos los grupos".');
  return { superadmin, allGroups, groupIds, areas: superadmin ? {} : areasFrom(fd) };
}

function password(fd: FormData) {
  const p = required(fd, 'password', 'la contraseña');
  if (p.length < 8) throw new ServiceError('La contraseña debe tener al menos 8 caracteres.');
  return p;
}

function done(msg: string) {
  revalidatePath('/usuarios', 'layout');
  return msg;
}

export async function createUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireSuperadmin();
    const email = required(fd, 'email', 'el correo').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError('El correo no es válido.');
    const r = await users.createUser(await createClient(), {
      email, password: password(fd), displayName: optStr(fd, 'display_name'), access: accessFrom(fd),
    });
    return done(r.reused
      ? `Ese correo ya existía en Supabase: se le dio acceso con estos permisos (su contraseña no cambió).`
      : `Usuario creado. Comparte el correo y la contraseña con ${optStr(fd, 'display_name') ?? email}.`);
  });
}

export async function saveUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireSuperadmin();
    await users.saveAccess(await createClient(), required(fd, 'id', 'la cuenta'), optStr(fd, 'display_name'),
      fd.get('is_active') === 'on', accessFrom(fd));
    return done('Permisos guardados.');
  });
}

export async function setPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireSuperadmin();
    await users.setPassword(required(fd, 'id', 'la cuenta'), password(fd));
    return done('Contraseña cambiada.');
  });
}

/** Interruptor de un área desde la tabla de usuarios. */
export async function setAreaAction(userId: string, area: string, level: Level | null): Promise<ActionState> {
  return runAction(async () => {
    await requireSuperadmin();
    if (!isArea(area)) throw new ServiceError('Área desconocida.');
    await users.setArea(await createClient(), userId, area, level);
    return done(level ? `${AREA_INFO[area].label}: ${level === 'edit' ? 'edición' : 'lectura'}.` : `${AREA_INFO[area].label}: sin acceso.`);
  });
}

export async function saveTemplateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireSuperadmin();
    const areas = areasFrom(fd);
    if (Object.keys(areas).length === 0) throw new ServiceError('Activa al menos un área.');
    await users.saveTemplate(await createClient(), {
      id: optStr(fd, 'id') ?? undefined,
      name: required(fd, 'name', 'el nombre'),
      description: optStr(fd, 'description'),
      areas,
      group_scoped: str(fd, 'scope') === 'groups',
    });
    return done('Plantilla guardada.');
  });
}

export async function deleteTemplateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireSuperadmin();
    await users.deleteTemplate(await createClient(), required(fd, 'id', 'la plantilla'));
    return done('Plantilla eliminada.');
  });
}

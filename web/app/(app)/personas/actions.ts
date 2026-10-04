'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireEditor } from '@/lib/services/session';
import * as persons from '@/lib/services/persons';
import { savePersonMonth } from '@/lib/services/reports';
import { ServiceError } from '@/lib/services/errors';
import { optStr, required, runAction, str, type ActionState } from '@/lib/action';
import { parsePeriodKey } from '@/lib/service-year';
import type { ReportState } from '@/lib/services/report-plan';

async function editor() {
  await requireEditor();
  return createClient();
}

function personInput(fd: FormData): persons.PersonInput {
  return {
    first_name: required(fd, 'first_name', 'el nombre'),
    last_name: required(fd, 'last_name', 'los apellidos'),
    birth_date: optStr(fd, 'birth_date'),
    is_active: fd.get('is_active') === 'on',
    notes: optStr(fd, 'notes'),
  };
}

function done(id: string, msg: string) {
  revalidatePath(`/personas/${id}`);
  revalidatePath('/personas');
  return msg;
}

export async function createPersonAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id = '';
  const res = await runAction(async () => {
    const db = await editor();
    id = await persons.createPerson(db, {
      ...personInput(fd),
      group_id: optStr(fd, 'group_id'),
      start_date: optStr(fd, 'group_start') ?? undefined,
    });
    revalidatePath('/personas');
    return 'Persona creada.';
  });
  if (res.ok && id) redirect(`/personas/${id}`);
  return res;
}

export async function updatePersonAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = required(fd, 'id', 'la persona');
    await persons.updatePerson(await editor(), id, personInput(fd));
    return done(id, 'Datos guardados.');
  });
}

export async function deletePersonAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    await persons.deletePerson(await editor(), required(fd, 'id', 'la persona'));
    revalidatePath('/personas');
    return 'Persona eliminada.';
  });
  if (res.ok) redirect('/personas');
  return res;
}

export async function addRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.addRolePeriod(await editor(), {
      person_id,
      role_id: required(fd, 'role_id', 'el cargo'),
      start_date: required(fd, 'start_date', 'la fecha de inicio'),
      end_date: optStr(fd, 'end_date'),
      notes: optStr(fd, 'notes'),
    });
    return done(person_id, 'Cargo agregado.');
  });
}

export async function closeRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.closeRolePeriod(await editor(), required(fd, 'id', 'el cargo'), required(fd, 'end_date', 'la fecha de fin'));
    return done(person_id, 'Cargo cerrado.');
  });
}

export async function deleteRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.deleteRolePeriod(await editor(), required(fd, 'id', 'el cargo'));
    return done(person_id, 'Periodo de cargo eliminado.');
  });
}

export async function addGroupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.addGroupPeriod(await editor(), {
      person_id,
      group_id: required(fd, 'group_id', 'el grupo'),
      start_date: required(fd, 'start_date', 'la fecha de inicio'),
      end_date: optStr(fd, 'end_date'),
    });
    return done(person_id, 'Grupo asignado.');
  });
}

export async function closeGroupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.closeGroupPeriod(await editor(), required(fd, 'id', 'el periodo'), required(fd, 'end_date', 'la fecha de fin'));
    return done(person_id, 'Periodo de grupo cerrado.');
  });
}

export async function deleteGroupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.deleteGroupPeriod(await editor(), required(fd, 'id', 'el periodo'));
    return done(person_id, 'Periodo de grupo eliminado.');
  });
}

export async function addContactAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.addContact(await editor(), {
      person_id,
      contact_type_id: required(fd, 'contact_type_id', 'el tipo de contacto'),
      value: required(fd, 'value', 'el valor'),
      is_primary: fd.get('is_primary') === 'on',
    });
    return done(person_id, 'Contacto agregado.');
  });
}

export async function deleteContactAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.deleteContact(await editor(), required(fd, 'id', 'el contacto'));
    return done(person_id, 'Contacto eliminado.');
  });
}

export async function setDateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.setDate(await editor(), {
      person_id,
      date_type_id: required(fd, 'date_type_id', 'el tipo de fecha'),
      date_value: required(fd, 'date_value', 'la fecha'),
    });
    return done(person_id, 'Fecha guardada.');
  });
}

export async function deleteDateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    await persons.deleteDate(await editor(), required(fd, 'id', 'la fecha'));
    return done(person_id, 'Fecha eliminada.');
  });
}

export async function saveReportAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const person_id = required(fd, 'person_id', 'la persona');
    const ym = parsePeriodKey(str(fd, 'mes'));
    if (!ym) throw new ServiceError('Elige el mes.');
    const state = str(fd, 'state') as ReportState;
    const res = await savePersonMonth(await editor(), person_id, ym, { state, hours: str(fd, 'hours') });
    revalidatePath('/', 'layout');
    return res.saved || res.deleted ? 'Informe guardado.' : 'Sin cambios.';
  });
}

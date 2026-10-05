// Lógica pura de la hoja de captura mensual: valida lo que llega del
// formulario y calcula qué filas insertar/actualizar y cuáles borrar,
// sin tocar las que no cambiaron (así la bitácora solo registra cambios
// reales). Se prueba en tests/report-plan.test.ts.

export type ReportState = '' | 'si' | 'no';

export interface SheetEntry {
  person_id: string;
  state: ReportState;   // '' = sin informe
  hours: string;        // texto tal cual del formulario
  studies?: string;     // cursos bíblicos; vacío = 0
}

export interface ExistingReport {
  id: string; person_id: string; participated: boolean; hours: number | null; bible_studies: number;
}

export interface PersonInfo { name: string; hoursRole: string | null }

export interface ReportUpsert {
  person_id: string; year: number; month: number; participated: boolean; hours: number | null; bible_studies: number;
}

export interface SavePlan {
  upserts: ReportUpsert[];
  deletes: string[];      // ids de monthly_reports
  errors: string[];
}

export function parseHours(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 'invalid';
  const n = Number(s);
  return n > 744 ? 'invalid' : n;
}

/** Cursos bíblicos: entero de 0 a 99; vacío cuenta como 0. */
export function parseStudies(raw: string | undefined): number | 'invalid' {
  const s = (raw ?? '').trim();
  if (s === '') return 0;
  if (!/^\d{1,2}$/.test(s)) return 'invalid';
  return Number(s);
}

export function planMonthSave(
  year: number,
  month: number,
  entries: SheetEntry[],
  existing: ExistingReport[],
  people: Map<string, PersonInfo>,
): SavePlan {
  const byPerson = new Map(existing.map((r) => [r.person_id, r]));
  const plan: SavePlan = { upserts: [], deletes: [], errors: [] };

  for (const e of entries) {
    const info = people.get(e.person_id);
    if (!info) {
      plan.errors.push('Hay una persona que no está en la hoja de ese mes (¿inactiva?). Actívala para registrar su informe.');
      continue;
    }
    const prev = byPerson.get(e.person_id);
    const hours = parseHours(e.hours);
    const studies = parseStudies(e.studies);

    if (hours === 'invalid') {
      plan.errors.push(`${info.name}: horas no válidas (número de 0 a 744, hasta 2 decimales).`);
      continue;
    }
    if (studies === 'invalid') {
      plan.errors.push(`${info.name}: cursos bíblicos no válidos (número entero de 0 a 99).`);
      continue;
    }
    if (e.state === '') {
      if (hours !== null && hours > 0) {
        plan.errors.push(`${info.name}: tiene horas pero no se marcó si participó.`);
      } else if (studies > 0) {
        plan.errors.push(`${info.name}: tiene cursos bíblicos pero no se marcó si participó.`);
      } else if (prev) {
        plan.deletes.push(prev.id);
      }
      continue;
    }

    const participated = e.state === 'si';
    if (info.hoursRole && hours === null) {
      plan.errors.push(`${info.name}: era ${info.hoursRole} ese mes, debe informar horas (0 si no hubo).`);
      continue;
    }
    if (!participated && hours !== null && hours > 0) {
      plan.errors.push(`${info.name}: informó horas, así que debe marcarse que participó.`);
      continue;
    }
    if (!participated && studies > 0) {
      plan.errors.push(`${info.name}: informó cursos bíblicos, así que debe marcarse que participó.`);
      continue;
    }
    if (prev && prev.participated === participated && numEq(prev.hours, hours)
        && Number(prev.bible_studies ?? 0) === studies) continue;
    plan.upserts.push({ person_id: e.person_id, year, month, participated, hours, bible_studies: studies });
  }
  return plan;
}

function numEq(a: number | null, b: number | null) {
  return a === null || b === null ? a === b : Number(a) === Number(b);
}

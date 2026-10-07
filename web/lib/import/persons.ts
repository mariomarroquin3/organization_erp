// Importación de personas desde Excel: plantilla, lectura y validación.
// Todo es puro salvo la lectura del archivo (exceljs). Lo usa
// app/(app)/personas/importar; probado en tests/import.test.ts.
import ExcelJS from 'exceljs';
import type { CatalogGroup, CatalogRole, CatalogType, MovementType } from '@/lib/types';
import { currentServiceYear } from '@/lib/service-year';

export const LIST_ROWS = 100;
export const MAX_ROWS = 1000;
export const SHEET = 'Personas';

export const COLUMNS = [
  { key: 'first_name', header: 'Nombre', help: 'Obligatorio.', width: 18 },
  { key: 'last_name', header: 'Apellidos', help: 'Obligatorio.', width: 22 },
  { key: 'birth_date', header: 'Fecha de nacimiento', help: 'Fecha (dd/mm/aaaa).', width: 14 },
  { key: 'group', header: 'Grupo', help: 'Nombre exacto de un grupo del sistema (ver hoja Listas).', width: 18 },
  { key: 'group_start', header: 'En el grupo desde', help: 'Fecha. Si se deja vacía: inicio del año de servicio actual (1 de septiembre).', width: 14 },
  { key: 'roles', header: 'Cargos', help: 'Códigos separados por coma, ej. "PR" o "PB, PAI". Solo un cargo con horas (PR, PAI). PA es por meses: agrégalo desde la ficha.', width: 12 },
  { key: 'roles_start', header: 'Cargos desde', help: 'Fecha. Si se deja vacía: inicio del año de servicio actual (1 de septiembre).', width: 14 },
  { key: 'phone', header: 'Teléfono', help: 'Opcional.', width: 16 },
  { key: 'email', header: 'Correo', help: 'Opcional.', width: 24 },
  { key: 'address', header: 'Dirección', help: 'Opcional.', width: 28 },
  { key: 'alta_date', header: 'Fecha de alta', help: 'Solo si llegó hace poco. Vacía = ya era miembro.', width: 14 },
  { key: 'alta_type', header: 'Motivo de alta', help: 'Obligatorio si hay fecha de alta (ver hoja Listas).', width: 22 },
  { key: 'alta_congregation', header: 'Congregación de origen', help: 'Obligatoria si el motivo es un traslado.', width: 22 },
  { key: 'notes', header: 'Notas', help: 'Opcional.', width: 28 },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]['key'];
export type RawValue = string | number | boolean | Date | null;
export interface RawRow { row: number; values: Partial<Record<ColumnKey, RawValue>> }

export interface ImportCatalogs {
  groups: CatalogGroup[];
  roles: CatalogRole[];
  contactTypes: CatalogType[];
  movementTypes: MovementType[];
}

export interface ImportPayload {
  row: number;
  first_name: string; last_name: string; birth_date: string | null; notes: string | null;
  group_id: string | null; group_start: string | null;
  role_ids: string[]; roles_start: string | null;
  contacts: { contact_type_id: string; value: string }[];
  alta: { movement_type_id: string; movement_date: string; congregation: string | null } | null;
}

export type RowStatus = 'ok' | 'error' | 'skip';

export interface PreviewRow {
  row: number;
  name: string;
  group: string | null;
  roles: string;
  status: RowStatus;
  messages: string[];
}

export interface ImportCheck {
  rows: PreviewRow[];
  payload: ImportPayload[];   // solo filas 'ok'
  counts: Record<RowStatus, number>;
  fileErrors: string[];       // problemas del archivo completo
}

// ---- utilidades ------------------------------------------------------

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function text(v: RawValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoDate(v);
  return String(v).trim();
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function validYmd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return isoDate(dt);
}

/**
 * Fecha de una celda: Date de Excel, número de serie de Excel, o texto
 * dd/mm/aaaa, d-m-aaaa o aaaa-mm-dd. Devuelve 'aaaa-mm-dd', null si está
 * vacía, o undefined si no se entiende.
 */
export function parseDate(v: RawValue | undefined): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : isoDate(v);
  if (typeof v === 'number') {
    if (v < 1 || v > 80000) return undefined;
    return isoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000));
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ?? undefined;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] - (+m[3] > 50 ? 100 : 0) : +m[3];
    return validYmd(y, +m[2], +m[1]) ?? undefined;
  }
  return undefined;
}

export function defaultStartDate(today = new Date()): string {
  return `${currentServiceYear(today) - 1}-09-01`;
}

// ---- lectura del archivo ---------------------------------------------

/** Valor plano de una celda de exceljs (fórmulas, enlaces, texto enriquecido). */
export function cellValue(v: ExcelJS.CellValue): RawValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return cellValue(v.text as ExcelJS.CellValue);
    if ('error' in v) return null;
  }
  return String(v);
}

const HEADER_KEYS = new Map<string, ColumnKey>(COLUMNS.map((c) => [normalize(c.header), c.key]));
HEADER_KEYS.set('nombres', 'first_name');
HEADER_KEYS.set('apellido', 'last_name');
HEADER_KEYS.set('cargo', 'roles');
HEADER_KEYS.set('email', 'email');
HEADER_KEYS.set('correo electronico', 'email');
HEADER_KEYS.set('telefono', 'phone');
HEADER_KEYS.set('nacimiento', 'birth_date');

export interface ReadResult { rows: RawRow[]; errors: string[] }

/** Lee la hoja "Personas" (o la primera). La fila de encabezados es la primera con "Nombre". */
export async function readWorkbook(data: ArrayBuffer): Promise<ReadResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { rows: [], errors: ['No se pudo leer el archivo. Debe ser un Excel .xlsx (por ejemplo, la plantilla descargada).'] };
  }
  const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: ['El archivo no tiene hojas.'] };

  let headerRow = 0;
  const cols = new Map<number, ColumnKey>();
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
    ws.getRow(r).eachCell((cell, col) => {
      const key = HEADER_KEYS.get(normalize(text(cellValue(cell.value)).replace(/\*/g, '')));
      if (key && ![...cols.values()].includes(key)) cols.set(col, key);
    });
    if ([...cols.values()].includes('first_name')) headerRow = r;
    else cols.clear();
  }
  if (!headerRow) {
    return { rows: [], errors: ['No se encontró la fila de encabezados (debe tener al menos "Nombre" y "Apellidos"). Usa la plantilla.'] };
  }
  if (![...cols.values()].includes('last_name')) {
    return { rows: [], errors: ['Falta la columna "Apellidos".'] };
  }

  const rows: RawRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const values: RawRow['values'] = {};
    let any = false;
    for (const [col, key] of cols) {
      const v = cellValue(ws.getRow(r).getCell(col).value);
      if (v !== null && text(v) !== '') { values[key] = v; any = true; }
    }
    if (any) rows.push({ row: r, values });
  }
  if (rows.length > MAX_ROWS) {
    return { rows: [], errors: [`El archivo tiene ${rows.length} filas; el máximo por importación es ${MAX_ROWS}.`] };
  }
  if (!rows.length) return { rows, errors: ['El archivo no tiene personas debajo de los encabezados.'] };
  return { rows, errors: [] };
}

// ---- validación --------------------------------------------------------

export function validateRows(
  raw: RawRow[],
  cat: ImportCatalogs,
  existingNames: string[],   // "nombre apellidos" de las personas que ya existen
  today = new Date(),
): Omit<ImportCheck, 'fileErrors'> {
  const todayIso = isoDate(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
  const defStart = defaultStartDate(today);
  const groups = new Map(cat.groups.filter((g) => g.is_active).map((g) => [normalize(g.name), g]));
  const roles = new Map<string, CatalogRole>();
  for (const r of cat.roles.filter((x) => x.is_active)) {
    roles.set(normalize(r.code), r);
    roles.set(normalize(r.name), r);
  }
  const altas = new Map<string, MovementType>();
  for (const t of cat.movementTypes.filter((x) => x.is_active && x.direction === 'ALTA')) {
    altas.set(normalize(t.name), t);
    altas.set(normalize(t.code), t);
  }
  const contactType = (code: string) => cat.contactTypes.find((c) => c.code === code);
  const existing = new Set(existingNames.map(normalize));
  const seen = new Map<string, number>();

  const rows: PreviewRow[] = [];
  const payload: ImportPayload[] = [];

  for (const { row, values: v } of raw) {
    const msgs: string[] = [];
    const first = text(v.first_name);
    const last = text(v.last_name);
    if (!first) msgs.push('Falta el nombre.');
    if (!last) msgs.push('Faltan los apellidos.');

    const date = (key: ColumnKey, label: string, opts: { notFuture?: boolean } = {}) => {
      const d = parseDate(v[key]);
      if (d === undefined) { msgs.push(`${label}: "${text(v[key])}" no es una fecha válida (usa dd/mm/aaaa).`); return null; }
      if (d && opts.notFuture && d > todayIso) msgs.push(`${label} no puede ser futura.`);
      return d;
    };
    const birth = date('birth_date', 'Fecha de nacimiento', { notFuture: true });
    const altaDate = date('alta_date', 'Fecha de alta', { notFuture: true });
    const groupStart = date('group_start', 'En el grupo desde');
    const rolesStart = date('roles_start', 'Cargos desde');

    // Grupo
    const groupName = text(v.group);
    const group = groupName ? groups.get(normalize(groupName)) : undefined;
    if (groupName && !group) msgs.push(`El grupo "${groupName}" no existe o está inactivo.`);

    // Cargos
    // Separados por coma, punto y coma, barra o " y "; si un trozo no es un
    // cargo (por nombre, que puede llevar espacios), se prueba palabra por palabra
    const roleTokens = text(v.roles).split(/[,;/]+|\s+y\s+/i).map((t) => t.trim()).filter(Boolean)
      .flatMap((t) => (roles.has(normalize(t)) ? [t] : t.split(/\s+/)));
    const roleList: CatalogRole[] = [];
    for (const t of roleTokens) {
      const r = roles.get(normalize(t));
      if (!r) msgs.push(`El cargo "${t}" no existe.`);
      else if (!roleList.includes(r)) roleList.push(r);
    }
    if (roleList.filter((r) => r.requires_hours_report).length > 1) {
      msgs.push(`No puede tener ${roleList.filter((r) => r.requires_hours_report).map((r) => r.code).join(' y ')} a la vez.`);
    }

    for (const r of roleList.filter((x) => x.requires_end_date)) {
      msgs.push(`${r.code} es por meses concretos: agrégalo desde la ficha con su fecha de fin${r.code === 'PA' ? ' (si es indefinido, usa PAI)' : ''}.`);
    }

    if (roleList.some((r) => r.code === 'PB') && roleList.some((r) => r.code === 'PNB')) {
      msgs.push('No puede ser PB y PNB a la vez.');
    }

    // Alta
    const altaName = text(v.alta_type);
    const congregation = text(v.alta_congregation) || null;
    let alta: ImportPayload['alta'] = null;
    if (altaName || altaDate) {
      const t = altaName ? altas.get(normalize(altaName)) : undefined;
      if (!altaName) msgs.push('Indica el motivo de alta.');
      else if (!t) msgs.push(`El motivo de alta "${altaName}" no existe.`);
      if (!altaDate && altaName) msgs.push('Indica la fecha de alta.');
      if (t?.requires_congregation && !congregation) msgs.push(`Para "${t.name}" indica la congregación de origen.`);
      if (t && altaDate) alta = { movement_type_id: t.id, movement_date: altaDate, congregation };
    }

    // Contactos
    const contacts: ImportPayload['contacts'] = [];
    const contact = (key: ColumnKey, code: string, label: string) => {
      const value = text(v[key]);
      if (!value) return;
      const ct = contactType(code);
      if (!ct) msgs.push(`No existe el tipo de contacto ${label} en el sistema.`);
      else contacts.push({ contact_type_id: ct.id, value });
    };
    contact('phone', 'PHONE', 'Teléfono');
    contact('email', 'EMAIL', 'Correo');
    contact('address', 'ADDRESS', 'Dirección');
    const email = text(v.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) msgs.push(`El correo "${email}" no es válido.`);

    // Si llegó después del inicio por defecto, grupo y cargos empiezan con su alta
    const start = (d: string | null) => d ?? (altaDate && altaDate > defStart ? altaDate : defStart);

    // Duplicados
    let status: RowStatus = msgs.length ? 'error' : 'ok';
    const key = normalize(`${first} ${last}`);
    if (first && last) {
      const prev = seen.get(key);
      if (prev) { msgs.push(`Repetida: la misma persona está en la fila ${prev}.`); status = 'error'; }
      else seen.set(key, row);
      if (existing.has(key)) {
        msgs.push('Ya existe en el sistema; se omite.');
        if (status === 'ok') status = 'skip';
      }
    }

    rows.push({
      row,
      name: [last, first].filter(Boolean).join(', ') || '(sin nombre)',
      group: group?.name ?? (groupName || null),
      roles: roleList.map((r) => r.code).join(', ') || roleTokens.join(', '),
      status,
      messages: msgs,
    });
    if (status === 'ok') {
      payload.push({
        row, first_name: first, last_name: last, birth_date: birth ?? null, notes: text(v.notes) || null,
        group_id: group?.id ?? null, group_start: group ? start(groupStart) : null,
        role_ids: roleList.map((r) => r.id), roles_start: roleList.length ? start(rolesStart) : null,
        contacts, alta,
      });
    }
  }

  const counts = { ok: 0, error: 0, skip: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, payload, counts };
}

// ---- plantilla ---------------------------------------------------------

export async function buildTemplate(cat: ImportCatalogs, today = new Date()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP de personal';
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.eachCell((cell, col) => {
    const required = col <= 2;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FF8A1C1C' : 'FF1F3A5F' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.note = COLUMNS[col - 1].help;
  });
  header.height = 30;

  const groups = cat.groups.filter((g) => g.is_active).map((g) => g.name);
  const roles = cat.roles.filter((r) => r.is_active);
  const altas = cat.movementTypes.filter((t) => t.is_active && t.direction === 'ALTA');

  const lists = wb.addWorksheet('Listas');
  lists.columns = [
    { header: 'Grupos', width: 22 }, { header: 'Cargos (código)', width: 16 }, { header: 'Cargo', width: 22 },
    { header: 'Motivos de alta', width: 30 },
  ];
  lists.getRow(1).font = { bold: true };
  const n = Math.max(groups.length, roles.length, altas.length);
  for (let i = 0; i < n; i++) {
    lists.addRow([groups[i] ?? null, roles[i]?.code ?? null, roles[i]?.name ?? null, altas[i]?.name ?? null]);
  }

  // Listas desplegables en Grupo y Motivo de alta. El rango llega hasta la
  // fila LIST_ROWS de Listas aunque haya menos grupos: un grupo escrito a
  // mano debajo del último también aparece (antes el rango terminaba en el
  // último grupo y no se actualizaba). Rango fijo y no OFFSET para que
  // funcione igual en Excel, LibreOffice y Google Sheets.
  const col = (key: ColumnKey) => COLUMNS.findIndex((c) => c.key === key) + 1;
  const listRange = (c: string) => `Listas!$${c}$2:$${c}$${LIST_ROWS + 1}`;
  const colRange = (key: ColumnKey) => {
    const letter = ws.getColumn(col(key)).letter;
    return `${letter}2:${letter}${MAX_ROWS + 1}`;
  };
  // Una validación por columna entera. Asignarla celda por celda hace que
  // exceljs escriba rangos solapados (ordena "D10" antes que "D2").
  const validations = (ws as unknown as { dataValidations: { add(a: string, v: ExcelJS.DataValidation): void } })
    .dataValidations;
  validations.add(colRange('group'), {
    type: 'list', allowBlank: true, formulae: [listRange('A')],
    showErrorMessage: true, errorTitle: 'Grupo',
    error: 'Elige un grupo de la lista (columna Grupos de la hoja Listas).',
  });
  validations.add(colRange('alta_type'), {
    type: 'list', allowBlank: true, formulae: [listRange('D')],
    showErrorMessage: true, errorTitle: 'Motivo de alta', error: 'Elige un motivo de la lista.',
  });
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    for (const k of ['birth_date', 'group_start', 'roles_start', 'alta_date'] as const) {
      ws.getCell(r, col(k)).numFmt = 'dd/mm/yyyy';
    }
  }

  const help = wb.addWorksheet('Instrucciones');
  help.columns = [{ header: 'Columna', width: 24 }, { header: 'Qué poner', width: 90 }];
  help.getRow(1).font = { bold: true };
  for (const c of COLUMNS) help.addRow([c.header, c.help]);
  help.addRow([]);
  for (const line of [
    'Una fila por persona en la hoja "Personas". No cambies los encabezados.',
    `Las fechas vacías de grupo y cargos toman el ${defaultStartDate(today).split('-').reverse().join('/')} (inicio del año de servicio actual).`,
    'La hoja Listas trae los grupos activos del sistema al descargar la plantilla. Si creas un grupo después, descarga la plantilla de nuevo o escríbelo debajo del último grupo (debe existir en Configuración con el mismo nombre).',
    'Las personas que ya existen con el mismo nombre y apellidos se omiten.',
    'Antes de guardar, la app muestra una vista previa con los errores de cada fila. Si hay errores no se guarda nada.',
  ]) help.addRow(['', line]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

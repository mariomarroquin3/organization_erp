import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildTemplate, parseDate, readWorkbook, validateRows, defaultStartDate, type ImportCatalogs, type RawRow,
} from '@/lib/import/persons';

const cat: ImportCatalogs = {
  groups: [
    { id: 'g1', name: 'Grupo Norte', description: null, is_active: true },
    { id: 'g2', name: 'Viejo', description: null, is_active: false },
  ],
  roles: [
    { id: 'pr', code: 'PR', name: 'PR', requires_hours_report: true, is_active: true, sort_order: 10 },
    { id: 'pa', code: 'PA', name: 'PA', requires_hours_report: true, is_active: true, sort_order: 20 },
    { id: 'pb', code: 'PB', name: 'PB', requires_hours_report: false, is_active: true, sort_order: 30 },
  ],
  contactTypes: [
    { id: 'tel', code: 'PHONE', name: 'Teléfono' }, { id: 'mail', code: 'EMAIL', name: 'Correo' },
    { id: 'dir', code: 'ADDRESS', name: 'Dirección' },
  ],
  movementTypes: [
    { id: 'ni', code: 'NUEVO_INGRESO', name: 'Nuevo ingreso', direction: 'ALTA', requires_congregation: false, is_active: true, sort_order: 1 },
    { id: 'td', code: 'TRASLADO_DESDE', name: 'Traslado desde otra congregación', direction: 'ALTA', requires_congregation: true, is_active: true, sort_order: 2 },
    { id: 'bj', code: 'OTRA_BAJA', name: 'Otra baja', direction: 'BAJA', requires_congregation: false, is_active: true, sort_order: 9 },
  ],
};
const TODAY = new Date(2026, 9, 4); // 4 oct 2026: año de servicio 2027
const row = (n: number, values: RawRow['values']): RawRow => ({ row: n, values });

describe('fechas', () => {
  it('acepta dd/mm/aaaa, aaaa-mm-dd, Date y número de serie de Excel', () => {
    expect(parseDate('15/03/1990')).toBe('1990-03-15');
    expect(parseDate('1990-03-15')).toBe('1990-03-15');
    expect(parseDate(new Date(Date.UTC(1990, 2, 15)))).toBe('1990-03-15');
    expect(parseDate(32947)).toBe('1990-03-15');
    expect(parseDate('')).toBeNull();
    expect(parseDate('31/02/1990')).toBeUndefined();
    expect(parseDate('mañana')).toBeUndefined();
  });
  it('el inicio por defecto es el 1 de septiembre del año de servicio actual', () => {
    expect(defaultStartDate(TODAY)).toBe('2026-09-01');
    expect(defaultStartDate(new Date(2026, 7, 31))).toBe('2025-09-01');
  });
});

describe('validación de filas', () => {
  it('arma la fila completa con grupo, cargos, contactos y fechas por defecto', () => {
    const r = validateRows([row(2, {
      first_name: 'Ana', last_name: 'López', group: 'grupo norte', roles: 'pb, PR',
      phone: 5551234, email: 'ana@example.com', birth_date: '01/05/1990',
    })], cat, [], TODAY);
    expect(r.counts).toEqual({ ok: 1, error: 0, skip: 0 });
    expect(r.payload[0]).toMatchObject({
      first_name: 'Ana', last_name: 'López', birth_date: '1990-05-01',
      group_id: 'g1', group_start: '2026-09-01', role_ids: ['pb', 'pr'], roles_start: '2026-09-01',
      contacts: [{ contact_type_id: 'tel', value: '5551234' }, { contact_type_id: 'mail', value: 'ana@example.com' }],
      alta: null,
    });
  });

  it('una persona que llegó después del 1 de septiembre empieza grupo y cargos en su alta', () => {
    const r = validateRows([row(2, {
      first_name: 'Beto', last_name: 'Ruiz', group: 'Grupo Norte', roles: 'PA',
      alta_date: '20/09/2026', alta_type: 'Traslado desde otra congregación', alta_congregation: 'Centro',
    })], cat, [], TODAY);
    expect(r.payload[0]).toMatchObject({
      group_start: '2026-09-20', roles_start: '2026-09-20',
      alta: { movement_type_id: 'td', movement_date: '2026-09-20', congregation: 'Centro' },
    });
  });

  it('marca errores fila por fila', () => {
    const r = validateRows([
      row(2, { first_name: 'Sin apellido' }),
      row(3, { first_name: 'C', last_name: 'D', group: 'Viejo', roles: 'PR, PA, XX' }),
      row(4, { first_name: 'E', last_name: 'F', birth_date: '2030-01-01', email: 'no-es-correo' }),
      row(5, { first_name: 'G', last_name: 'H', alta_type: 'Traslado desde otra congregación', alta_date: '01/09/2026' }),
      row(6, { first_name: 'I', last_name: 'J', alta_type: 'Otra baja', alta_date: '01/09/2026' }),
    ], cat, [], TODAY);
    expect(r.counts.error).toBe(5);
    expect(r.payload).toHaveLength(0);
    const msg = (n: number) => r.rows.find((x) => x.row === n)!.messages.join(' ');
    expect(msg(2)).toContain('apellidos');
    expect(msg(3)).toContain('"Viejo" no existe');
    expect(msg(3)).toContain('"XX" no existe');
    expect(msg(3)).toContain('PR y PA a la vez');
    expect(msg(4)).toContain('no puede ser futura');
    expect(msg(4)).toContain('correo');
    expect(msg(5)).toContain('congregación de origen');
    expect(msg(6)).toContain('motivo de alta "Otra baja" no existe');
  });

  it('omite a quien ya existe y marca repetidos dentro del archivo', () => {
    const r = validateRows([
      row(2, { first_name: 'Ána', last_name: 'lopez' }),
      row(3, { first_name: 'Luis', last_name: 'Pérez' }),
      row(4, { first_name: 'luis', last_name: 'PEREZ' }),
    ], cat, ['Ana López'], TODAY);
    expect(r.rows.map((x) => x.status)).toEqual(['skip', 'ok', 'error']);
    expect(r.rows[2].messages[0]).toContain('fila 3');
    expect(r.payload.map((p) => p.row)).toEqual([3]);
  });
});

describe('plantilla y lectura', () => {
  it('la plantilla trae encabezados y listas, y se vuelve a leer igual', async () => {
    const buf = await buildTemplate(cat, TODAY);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Personas', 'Listas', 'Instrucciones']);
    expect(wb.getWorksheet('Listas')!.getCell('A2').value).toBe('Grupo Norte');
    expect(wb.getWorksheet('Listas')!.getCell('A3').value).toBeNull(); // grupo inactivo fuera

    const ws = wb.getWorksheet('Personas')!;
    ws.getCell('A2').value = 'Ana';
    ws.getCell('B2').value = 'López';
    ws.getCell('C2').value = new Date(Date.UTC(1990, 4, 1));
    ws.getCell('D2').value = 'Grupo Norte';
    ws.getCell('F2').value = 'PR';
    ws.getCell('I2').value = { text: 'ana@example.com', hyperlink: 'mailto:ana@example.com' };
    const out = await readWorkbook(await wb.xlsx.writeBuffer() as ArrayBuffer);
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(1);
    const r = validateRows(out.rows, cat, [], TODAY);
    expect(r.counts.ok).toBe(1);
    expect(r.payload[0]).toMatchObject({ birth_date: '1990-05-01', group_id: 'g1', role_ids: ['pr'] });
    expect(r.payload[0].contacts).toEqual([{ contact_type_id: 'mail', value: 'ana@example.com' }]);
  });

  it('rechaza archivos que no son Excel o sin encabezados', async () => {
    expect((await readWorkbook(new TextEncoder().encode('hola').buffer as ArrayBuffer)).errors[0]).toContain('No se pudo leer');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Hoja1').addRow(['a', 'b']);
    expect((await readWorkbook(await wb.xlsx.writeBuffer() as ArrayBuffer)).errors[0]).toContain('encabezados');
  });
});

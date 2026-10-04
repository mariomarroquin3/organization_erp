import ExcelJS from 'exceljs';
import type { ReportTable } from './tables';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };

export async function toXlsx(tables: ReportTable[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP de personal';
  wb.created = new Date();

  const used = new Set<string>();
  for (const t of tables) {
    const ws = wb.addWorksheet(sheetName(t.key, used), {
      pageSetup: { orientation: t.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 4 }],
    });
    ws.addRow([t.title]).font = { bold: true, size: 14 };
    ws.addRow([t.subtitle]).font = { italic: true, color: { argb: 'FF555555' } };
    ws.addRow([]);
    const header = ws.addRow(t.columns.map((c) => c.header));
    header.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = HEADER_FILL;
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    header.height = 30;

    for (const r of t.rows) {
      // Los porcentajes llegan como 0-100; Excel los quiere como fracción
      ws.addRow(r.map((v, i) => (t.columns[i]?.format === 'pct' && typeof v === 'number' ? v / 100 : v)));
    }

    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.max(10, Math.min(18, c.header.length + 2));
      if (c.format === 'num') col.numFmt = '#,##0.##';
      if (c.format === 'pct') col.numFmt = '0.0%';
    });
    if (t.rows.length) {
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + t.rows.length, column: t.columns.length } };
    }
    if (t.notes?.length) {
      ws.addRow([]);
      for (const note of t.notes) ws.addRow([note]).font = { italic: true, size: 9, color: { argb: 'FF555555' } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Excel limita los nombres de hoja a 31 caracteres sin []:*?/\
function sheetName(raw: string, used: Set<string>) {
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name);
  return name;
}

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Cell, ReportTable } from './tables';
import { fmtNum, fmtPct } from '@/lib/format';

/** Un PDF con una sección por tabla; cada tabla empieza en página nueva. */
export function toPdf(tables: ReportTable[], generatedAt = new Date()): Buffer {
  const first = tables[0];
  const doc = new jsPDF({ orientation: first?.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
  const stamp = `Generado el ${generatedAt.toLocaleString('es', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC`;

  tables.forEach((t, idx) => {
    if (idx > 0) doc.addPage('letter', t.landscape ? 'landscape' : 'portrait');
    const margin = 36;
    doc.setFont('helvetica', 'bold').setFontSize(15).text(t.title, margin, margin + 6);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90).text(t.subtitle, margin, margin + 22);
    doc.setTextColor(0);

    const right = new Set(t.columns.flatMap((c, i) => (c.format && c.format !== 'text' ? [i] : [])));
    autoTable(doc, {
      startY: margin + 34,
      margin: { left: margin, right: margin, bottom: 40 },
      head: [t.columns.map((c) => c.header)],
      body: t.rows.length
        ? t.rows.map((r) => r.map((v, i) => fmtCell(v, t.columns[i]?.format)))
        : [[{ content: 'Sin datos para este periodo.', colSpan: t.columns.length }]],
      styles: { font: 'helvetica', fontSize: t.columns.length > 12 ? 7 : 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [31, 58, 95], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 246, 249] },
      columnStyles: Object.fromEntries([...right].map((i) => [i, { halign: 'right' as const }])),
      didParseCell: (data) => {
        if (data.section === 'body' && data.cell.raw === 'Falta') data.cell.styles.textColor = [180, 30, 30];
      },
    });

    const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin + 40;
    if (t.notes?.length) {
      doc.setFontSize(8).setTextColor(90);
      t.notes.forEach((note, i) => doc.text(note, margin, y + 16 + i * 11));
      doc.setTextColor(0);
    }
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.setFontSize(8).setTextColor(120);
    doc.text(stamp, 36, h - 18);
    doc.text(`Página ${p} de ${pages}`, w - 36, h - 18, { align: 'right' });
  }
  return Buffer.from(doc.output('arraybuffer'));
}

function fmtCell(v: Cell, format?: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return format === 'pct' ? fmtPct(v) : fmtNum(v);
  return v;
}

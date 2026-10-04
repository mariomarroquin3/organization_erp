import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/services/session';
import { buildTables } from '@/lib/export/build';
import { REPORT_KEYS, type ReportKey } from '@/lib/export/tables';
import { toXlsx } from '@/lib/export/xlsx';
import { toPdf } from '@/lib/export/pdf';
import { parseServiceYear } from '@/lib/service-year';

export const runtime = 'nodejs';

// GET /api/export?informe=cumplimiento|completitud|matriz|mensual|personas|movimientos|todo&anio=2026&formato=xlsx|pdf
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.role) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const key = q.get('informe') ?? 'todo';
  const format = q.get('formato') === 'pdf' ? 'pdf' : 'xlsx';
  if (key !== 'todo' && !REPORT_KEYS.includes(key as ReportKey)) {
    return NextResponse.json({ error: 'Informe desconocido' }, { status: 400 });
  }
  const sy = parseServiceYear(q.get('anio'));

  const db = await createClient();
  const tables = await buildTables(db, key as ReportKey | 'todo', sy);
  const body = format === 'pdf' ? toPdf(tables) : await toXlsx(tables);
  const name = `${key === 'todo' ? 'informes' : key}-${key === 'personas' ? 'actual' : `ano-servicio-${sy}`}.${format}`;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}

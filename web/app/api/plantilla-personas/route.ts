import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/services/session';
import { importCatalogs } from '@/lib/services/import';
import { buildTemplate } from '@/lib/import/persons';

export const runtime = 'nodejs';

// GET /api/plantilla-personas: Excel vacío con listas de grupos, cargos y motivos
export async function GET() {
  const session = await getSession();
  if (!session?.role) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await buildTemplate(await importCatalogs(await createClient()));
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-personas.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}

import Link from 'next/link';
import { Empty, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { listPersons } from '@/lib/services/persons';
import { listGroups, listRoles } from '@/lib/services/catalogs';
import { getSession } from '@/lib/services/session';
import { fmtDate } from '@/lib/format';
import { param, type SearchParams } from '@/lib/page';

export default async function PersonasPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const f = {
    q: param(sp, 'q') ?? '',
    groupId: param(sp, 'grupo') ?? '',
    role: param(sp, 'cargo') ?? '',
    status: (param(sp, 'estado') ?? 'activos') as 'activos' | 'inactivos' | 'todos',
  };
  const db = await createClient();
  const [rows, groups, roles, session] = await Promise.all([
    listPersons(db, f), listGroups(db), listRoles(db), getSession(),
  ]);

  return (
    <>
      <PageHeader title="Personas">
        {session?.canEdit ? <Link className="btn" href="/personas/nueva">+ Nueva persona</Link> : null}
      </PageHeader>

      <form className="toolbar" action="/personas">
        <input type="search" name="q" placeholder="Buscar por nombre" defaultValue={f.q} />
        <select name="grupo" defaultValue={f.groupId} aria-label="Grupo">
          <option value="">Todos los grupos</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select name="cargo" defaultValue={f.role} aria-label="Cargo">
          <option value="">Cualquier cargo</option>
          {roles.map((r) => <option key={r.id} value={r.code}>{r.code} · {r.name}</option>)}
          <option value="NINGUNO">Sin cargo</option>
        </select>
        <select name="estado" defaultValue={f.status} aria-label="Estado">
          <option value="activos">Activas</option>
          <option value="inactivos">Inactivas</option>
          <option value="todos">Todas</option>
        </select>
        <button className="btn-secondary" type="submit">Filtrar</button>
        <span className="muted">{rows.length} persona(s)</span>
      </form>

      <div className="card">
        {rows.length === 0 ? <Empty>No hay personas con esos filtros.</Empty> : (
          <table className="table">
            <thead><tr><th>Nombre</th><th>Grupo</th><th>Cargos actuales</th><th>Nacimiento</th><th>Estado</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.person_id}>
                  <td><Link href={`/personas/${p.person_id}`}>{p.last_name}, {p.first_name}</Link></td>
                  <td>{p.group_name ?? '—'}</td>
                  <td>{p.current_roles ?? <span className="muted">Sin cargo</span>}</td>
                  <td>{fmtDate(p.birth_date)}</td>
                  <td>{p.is_active ? 'Activa' : <span className="badge badge-muted">Inactiva</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

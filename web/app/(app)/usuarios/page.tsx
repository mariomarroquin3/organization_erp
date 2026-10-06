import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AccessFields } from '@/components/AccessFields';
import { AreaToggle } from '@/components/AreaToggle';
import { Empty, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { hasServiceRole } from '@/lib/supabase/admin';
import { listGroups } from '@/lib/services/catalogs';
import { listTemplates, listUsers, type Template } from '@/lib/services/users';
import { requireSession } from '@/lib/services/session';
import { AREAS, AREA_INFO, LEVEL_LABEL } from '@/lib/permissions';
import * as A from './actions';

export default async function UsuariosPage() {
  const session = await requireSession();
  if (!session.isSuperadmin) redirect('/');
  const db = await createClient();
  const [users, templates, groups] = await Promise.all([listUsers(db), listTemplates(db), listGroups(db, { onlyActive: true })]);
  const canCreate = hasServiceRole();

  return (
    <>
      <PageHeader title="Usuarios" />

      <section className="card">
        <h2>Cuentas</h2>
        <p className="muted small">
          Usa los interruptores para dar o quitar el acceso a un área al momento; la etiqueta cambia entre lectura y edición.
          Para cambiar los grupos que ve alguien, su nombre o contraseña, entra a <strong>Editar</strong>.
        </p>
        {users.length === 0 ? <Empty>No hay cuentas.</Empty> : (
          <div className="table-wrap">
            <table className="table users-table">
              <thead>
                <tr>
                  <th>Usuario</th><th>Personas que ve</th>
                  {AREAS.map((a) => <th key={a}>{AREA_INFO[a].label}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.isActive ? undefined : 'muted'}>
                    <td>
                      <strong>{u.displayName ?? u.email ?? 'Sin nombre'}</strong>
                      {u.displayName && u.email ? <div className="muted small">{u.email}</div> : null}
                      {!u.isActive ? <span className="badge badge-muted">Desactivada</span> : null}
                    </td>
                    {u.superadmin ? (
                      <td colSpan={AREAS.length + 1}><span className="badge badge-info">Super administrador</span> <span className="muted small">acceso a todo</span></td>
                    ) : (
                      <>
                        <td>{u.allGroups ? 'Todas' : u.groupNames.join(', ')}</td>
                        {AREAS.map((a) => (
                          <td key={a}><AreaToggle userId={u.id} area={a} level={u.areas[a] ?? null} /></td>
                        ))}
                      </>
                    )}
                    <td>{u.id === session.userId && u.superadmin ? <span className="muted small">Tú</span> : <Link href={`/usuarios/${u.id}`}>Editar</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Nuevo usuario</h2>
        {!canCreate ? (
          <p className="note">
            Para crear usuarios desde aquí falta configurar la variable <code>SUPABASE_SERVICE_ROLE_KEY</code> en el servidor
            (Vercel → Settings → Environment Variables). Mientras tanto puedes crear el usuario en Supabase (Authentication → Users)
            y darle permisos con el mismo correo: la app lo reconoce.
          </p>
        ) : null}
        <ActionForm action={A.createUserAction} className="stack" resetOnSuccess>
          <div className="form-grid">
            <label>Nombre<input name="display_name" placeholder="Cómo se verá en la lista" /></label>
            <label>Correo<input name="email" type="email" required autoComplete="off" /></label>
            <label>Contraseña inicial<input name="password" type="text" required minLength={8} autoComplete="new-password" placeholder="Mínimo 8 caracteres" /></label>
          </div>
          <AccessFields
            initial={{ superadmin: false, scope: 'all', groupIds: [], areas: {} }}
            groups={groups} templates={templates} allowSuperadmin
          />
          <div><SubmitButton>Crear usuario</SubmitButton></div>
        </ActionForm>
      </section>

      <section className="card">
        <h2>Plantillas</h2>
        <p className="muted small">
          Una plantilla llena los permisos al crear un usuario; después puedes ajustarlos. Cambiar una plantilla no cambia
          a los usuarios ya creados con ella.
        </p>
        {templates.length === 0 ? <Empty>No hay plantillas.</Empty> : templates.map((t) => (
          <details key={t.id} className="template">
            <summary>
              <strong>{t.name}</strong> · {summary(t)} · <span className="muted">{t.group_scoped ? 'solo sus grupos' : 'todas las personas'}</span>
              {t.description ? <div className="muted small">{t.description}</div> : null}
            </summary>
            <TemplateForm template={t} groups={groups} />
            <ActionForm action={A.deleteTemplateAction} confirm={`¿Eliminar la plantilla "${t.name}"?`}>
              <input type="hidden" name="id" value={t.id} />
              <SubmitButton className="btn-link danger" pendingText="…">Eliminar plantilla</SubmitButton>
            </ActionForm>
          </details>
        ))}
        <details className="template">
          <summary><strong>+ Nueva plantilla</strong></summary>
          <TemplateForm groups={groups} />
        </details>
      </section>
    </>
  );
}

function summary(t: Template) {
  const parts = AREAS.filter((a) => t.areas[a]).map((a) => `${AREA_INFO[a].label} (${LEVEL_LABEL[t.areas[a]!].toLowerCase()})`);
  return parts.join(', ') || '—';
}

function TemplateForm({ template, groups }: { template?: Template; groups: { id: string; name: string }[] }) {
  return (
    <ActionForm action={A.saveTemplateAction} className="stack" resetOnSuccess={!template}>
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <div className="form-grid">
        <label>Nombre<input name="name" required defaultValue={template?.name} /></label>
        <label>Descripción<input name="description" defaultValue={template?.description ?? ''} /></label>
      </div>
      {/* Sin grupos que elegir: en la plantilla solo se indica si el usuario verá "sus grupos" */}
      <AccessFields
        initial={{ superadmin: false, scope: template?.group_scoped ? 'groups' : 'all', groupIds: [], areas: template?.areas ?? {} }}
        groups={[]}
      />
      <div><SubmitButton className="btn-secondary">{template ? 'Guardar plantilla' : 'Crear plantilla'}</SubmitButton></div>
    </ActionForm>
  );
}

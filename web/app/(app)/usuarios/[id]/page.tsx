import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AccessFields } from '@/components/AccessFields';
import { PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { hasServiceRole } from '@/lib/supabase/admin';
import { listGroups } from '@/lib/services/catalogs';
import { listTemplates, listUsers } from '@/lib/services/users';
import { requireAreaPage } from '@/lib/services/session';
import * as A from '../actions';

export default async function UsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAreaPage('USUARIOS', 'edit');
  const { id } = await params;
  // Nadie cambia su propia cuenta desde aquí (la base también lo impide)
  if (id === session.userId) redirect('/usuarios');
  const db = await createClient();
  const [users, templates, groups] = await Promise.all([listUsers(db), listTemplates(db), listGroups(db)]);
  const u = users.find((x) => x.id === id);
  if (!u) notFound();
  // Grupos activos más los inactivos que ya tenga asignados
  const groupOptions = groups.filter((g) => g.is_active || u.groupIds.includes(g.id));

  return (
    <>
      <PageHeader title={u.displayName ?? u.email ?? 'Usuario'}>
        <Link className="btn-secondary" href="/usuarios">← Usuarios</Link>
      </PageHeader>

      <ActionForm action={A.saveUserAction} className="card stack">
        <input type="hidden" name="id" value={u.id} />
        <div className="form-grid">
          <label>Nombre<input name="display_name" defaultValue={u.displayName ?? ''} /></label>
          <label>Correo<input value={u.email ?? '—'} disabled /></label>
        </div>
        <label className="inline"><input type="checkbox" name="is_active" defaultChecked={u.isActive} /> Cuenta activa (si la desactivas ya no puede entrar a ver datos)</label>
        <AccessFields
          initial={{ superadmin: u.superadmin, scope: u.allGroups ? 'all' : 'groups', groupIds: u.groupIds, areas: u.areas }}
          groups={groupOptions} templates={templates} allowSuperadmin={session.isSuperadmin}
        />
        <div><SubmitButton>Guardar</SubmitButton></div>
      </ActionForm>

      {hasServiceRole() ? (
        <section className="card">
          <h2>Cambiar contraseña</h2>
          <ActionForm action={A.setPasswordAction} className="inline-form" resetOnSuccess>
            <input type="hidden" name="id" value={u.id} />
            <input name="password" type="text" required minLength={8} autoComplete="new-password" placeholder="Nueva contraseña (mín. 8)" aria-label="Nueva contraseña" />
            <SubmitButton className="btn-secondary">Cambiar</SubmitButton>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}

import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { requireSession } from '@/lib/services/session';
import { signOut } from '@/app/login/actions';

const ROLE_LABEL = { SUPERADMIN: 'Super administrador', ADMIN: 'Administrador', READER: 'Lector' } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">ERP de personal</div>
        <Nav />
        <div className="whoami">
          <div>{session.email}</div>
          <div className="muted">{session.role ? ROLE_LABEL[session.role] : 'Sin acceso'}</div>
          <form action={signOut}><button className="btn-link" type="submit">Cerrar sesión</button></form>
        </div>
      </aside>
      <main className="content">
        {session.role ? children : (
          <div className="card">
            <h1>Cuenta sin acceso</h1>
            <p>Tu usuario existe pero no tiene una cuenta activa en el sistema. Pide a un super administrador que te dé acceso.</p>
          </div>
        )}
      </main>
    </div>
  );
}

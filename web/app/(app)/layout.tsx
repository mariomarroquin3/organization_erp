import type { ReactNode } from 'react';
import { Nav, type NavLink } from '@/components/Nav';
import { can, requireSession, type Session } from '@/lib/services/session';
import type { Area } from '@/lib/permissions';
import { signOut } from '@/app/login/actions';

// Cada enlace aparece solo si la cuenta puede leer su área
const LINKS: (NavLink & { area?: Area; superadmin?: boolean })[] = [
  { href: '/', label: 'Panel' },
  { href: '/informes', label: 'Informes del mes', area: 'INFORMES' },
  { href: '/personas', label: 'Personas', area: 'PERSONAS' },
  { href: '/movimientos', label: 'Altas y bajas', area: 'MOVIMIENTOS' },
  { href: '/metricas', label: 'Métricas', area: 'METRICAS' },
  { href: '/informe-anual', label: 'Informe anual', area: 'METRICAS' },
  { href: '/exportar', label: 'Exportar', area: 'METRICAS' },
  { href: '/configuracion', label: 'Configuración', area: 'CONFIGURACION' },
  { href: '/usuarios', label: 'Usuarios', superadmin: true },
];

function accessLabel(s: Session) {
  if (!s.role) return 'Sin acceso';
  if (s.isSuperadmin) return 'Super administrador';
  return s.allGroups ? 'Todos los grupos' : s.groups.map((g) => g.name).join(', ') || 'Sin grupos';
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const links = LINKS
    .filter((l) => (l.superadmin ? session.isSuperadmin : !l.area || can(session, l.area)))
    .map(({ href, label }) => ({ href, label }));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">ERP de personal</div>
        {session.role ? <Nav links={links} /> : null}
        <div className="whoami">
          <div>{session.email}</div>
          <div className="muted">{accessLabel(session)}</div>
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

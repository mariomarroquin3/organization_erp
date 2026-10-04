'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Panel' },
  { href: '/informes', label: 'Informes del mes' },
  { href: '/personas', label: 'Personas' },
  { href: '/movimientos', label: 'Altas y bajas' },
  { href: '/metricas', label: 'Métricas' },
  { href: '/exportar', label: 'Exportar' },
  { href: '/configuracion', label: 'Configuración' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return <Link key={l.href} href={l.href} className={active ? 'active' : undefined}>{l.label}</Link>;
      })}
    </nav>
  );
}

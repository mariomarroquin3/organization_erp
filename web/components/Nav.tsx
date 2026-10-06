'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavLink { href: string; label: string }

export function Nav({ links }: { links: NavLink[] }) {
  const path = usePathname();
  return (
    <nav className="nav">
      {links.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return <Link key={l.href} href={l.href} className={active ? 'active' : undefined}>{l.label}</Link>;
      })}
    </nav>
  );
}

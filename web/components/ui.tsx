import type { ReactNode } from 'react';
import { STATUS_LABEL } from '@/lib/format';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {children ? <div className="page-tools">{children}</div> : null}
    </header>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls = {
    CUMPLIDA: 'ok', 'AL DIA': 'info', ATRASADO: 'warn', 'NO CUMPLIDA': 'bad', 'SIN META': 'muted',
  }[status] ?? 'muted';
  return <span className={`badge badge-${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Progress({ value }: { value: number | null }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, Number(value)));
  const tone = v >= 100 ? 'ok' : v >= 75 ? 'info' : v >= 50 ? 'warn' : 'bad';
  return (
    <span className="progress" title={value === null ? 'Sin dato' : `${value} %`}>
      <span className={`progress-bar progress-${tone}`} style={{ width: `${v}%` }} />
    </span>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function ReadOnlyNote() {
  return <p className="note">En esta sección tu cuenta es de solo lectura: puedes consultar, pero no modificar.</p>;
}

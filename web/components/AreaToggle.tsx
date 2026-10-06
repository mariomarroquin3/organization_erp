'use client';
import { useState, useTransition } from 'react';
import { setAreaAction } from '@/app/(app)/usuarios/actions';
import { AREA_INFO, type Area, type Level } from '@/lib/permissions';
import { Switch } from './AccessFields';

/** Celda de la tabla de usuarios: activa/desactiva un área y cambia lectura/edición al momento. */
export function AreaToggle({ userId, area, level: initial }: { userId: string; area: Area; level: Level | null }) {
  const [level, setLevel] = useState(initial);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const info = AREA_INFO[area];

  const change = (next: Level | null) => {
    const prev = level;
    setLevel(next);
    setError('');
    start(async () => {
      const r = await setAreaAction(userId, area, next);
      if (!r.ok) { setLevel(prev); setError(r.message); }
    });
  };

  return (
    <span className="toggle-cell">
      <Switch on={!!level} disabled={pending} label={`${info.label}: ${level ? 'con acceso' : 'sin acceso'}`}
        onChange={(on) => change(on ? 'read' : null)} />
      {level && info.editable ? (
        <button type="button" className={`level-chip${level === 'edit' ? ' edit' : ''}`} disabled={pending}
          title="Cambiar entre lectura y edición" onClick={() => change(level === 'edit' ? 'read' : 'edit')}>
          {level === 'edit' ? 'Edición' : 'Lectura'}
        </button>
      ) : level ? <span className="level-chip">Lectura</span> : null}
      {error ? <span className="msg-error small" role="alert">{error}</span> : null}
    </span>
  );
}

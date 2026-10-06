'use client';
import { useState } from 'react';
import { AREAS, AREA_INFO, type AreaMap, type Level } from '@/lib/permissions';

export interface AccessValue {
  superadmin: boolean;
  scope: 'all' | 'groups';
  groupIds: string[];
  areas: AreaMap;
}

export interface TemplateOption { id: string; name: string; description: string | null; areas: AreaMap; group_scoped: boolean }

export function Switch({ on, onChange, disabled, label }: {
  on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label}
      className="switch" disabled={disabled} onClick={() => onChange(!on)} />
  );
}

/**
 * Campos de permisos de una cuenta o plantilla: un interruptor por área,
 * lectura o edición, y el alcance (todas las personas o solo unos grupos).
 * Envía area_<ÁREA>, scope, group_ids y superadmin.
 */
export function AccessFields({ initial, groups, templates, allowSuperadmin = false }: {
  initial: AccessValue;
  groups: { id: string; name: string }[];
  templates?: TemplateOption[];
  allowSuperadmin?: boolean;
}) {
  const [v, setV] = useState(initial);
  const [templateId, setTemplateId] = useState('');
  const setArea = (a: (typeof AREAS)[number], level: Level | null) =>
    setV((p) => {
      const areas = { ...p.areas };
      if (level) areas[a] = level; else delete areas[a];
      return { ...p, areas };
    });
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (t) setV((p) => ({ ...p, superadmin: false, areas: { ...t.areas }, scope: t.group_scoped ? 'groups' : 'all' }));
  };
  const chosen = templates?.find((t) => t.id === templateId);

  return (
    <div className="stack">
      {templates?.length ? (
        <label>Plantilla
          <select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Elegir una plantilla (opcional)…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {chosen?.description ? <span className="muted small">{chosen.description} Puedes ajustar los permisos abajo.</span> : null}
        </label>
      ) : null}

      {allowSuperadmin ? (
        <label className="inline">
          <input type="checkbox" name="superadmin" checked={v.superadmin}
            onChange={(e) => setV((p) => ({ ...p, superadmin: e.target.checked }))} />
          Super administrador (acceso a todo y gestiona usuarios)
        </label>
      ) : null}

      {v.superadmin ? null : (
        <>
          <table className="table compact">
            <thead><tr><th>Acceso</th><th>Área</th><th>Permiso</th></tr></thead>
            <tbody>
              {AREAS.map((a) => {
                const level = v.areas[a];
                const info = AREA_INFO[a];
                return (
                  <tr key={a}>
                    <td>
                      <Switch on={!!level} label={`Acceso a ${info.label}`} onChange={(on) => setArea(a, on ? 'read' : null)} />
                      <input type="hidden" name={`area_${a}`} value={level ?? ''} />
                    </td>
                    <td><strong>{info.label}</strong><div className="muted small">{info.description}</div></td>
                    <td>
                      {!level ? <span className="muted">Sin acceso</span> : !info.editable ? <span>Lectura</span> : (
                        <div className="segmented" role="radiogroup" aria-label={`Permiso en ${info.label}`}>
                          {(['read', 'edit'] as const).map((l) => (
                            <label key={l} className={level === l ? 'on' : undefined}>
                              <input type="radio" checked={level === l} onChange={() => setArea(a, l)} />
                              {l === 'read' ? 'Lectura' : 'Edición'}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <fieldset className="stack">
            <legend>Personas que puede ver</legend>
            <label className="inline">
              <input type="radio" name="scope" value="all" checked={v.scope === 'all'} onChange={() => setV((p) => ({ ...p, scope: 'all' }))} />
              Todas
            </label>
            <label className="inline">
              <input type="radio" name="scope" value="groups" checked={v.scope === 'groups'} onChange={() => setV((p) => ({ ...p, scope: 'groups' }))} />
              Solo las de ciertos grupos
            </label>
            {v.scope === 'groups' && groups.length ? (
              <div className="toolbar">
                {groups.map((g) => (
                  <label key={g.id} className="inline">
                    <input type="checkbox" name="group_ids" value={g.id} checked={v.groupIds.includes(g.id)}
                      onChange={(e) => setV((p) => ({
                        ...p, groupIds: e.target.checked ? [...p.groupIds, g.id] : p.groupIds.filter((x) => x !== g.id),
                      }))} />
                    {g.name}
                  </label>
                ))}
              </div>
            ) : null}
            <span className="muted small">
              Aplica a Personas, Altas y bajas, Informes y Métricas: con un grupo solo ve, edita y exporta a esas personas.
            </span>
          </fieldset>
        </>
      )}
    </div>
  );
}

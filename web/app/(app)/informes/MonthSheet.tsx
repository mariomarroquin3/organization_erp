'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FormMessage, PendingProvider, SubmitButton, useFormAction } from '@/components/ActionForm';
import type { SheetRow } from '@/lib/services/reports';
import { saveSheetAction } from './actions';

type RowState = { state: '' | 'si' | 'no'; hours: string; studies: string };

function initial(r: SheetRow): RowState {
  if (!r.report) return { state: '', hours: '', studies: '' };
  return {
    state: r.report.participated ? 'si' : 'no',
    hours: r.report.hours === null ? '' : String(r.report.hours),
    studies: r.report.bible_studies ? String(r.report.bible_studies) : '',
  };
}

export function MonthSheet({ rows, mes, canEdit, anio }: { rows: SheetRow[]; mes: string; canEdit: boolean; anio: number }) {
  const { state: result, onSubmit, pending } = useFormAction(saveSheetAction);
  const [values, setValues] = useState<Record<string, RowState>>(
    () => Object.fromEntries(rows.map((r) => [r.person_id, initial(r)])),
  );
  const [filter, setFilter] = useState('');
  const [group, setGroup] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group_name ?? 'Sin grupo'))].sort(), [rows]);
  const set = (id: string, patch: Partial<RowState>) =>
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }));

  const visible = (r: SheetRow) => {
    const v = values[r.person_id];
    if (onlyMissing && v.state !== '') return false;
    if (group && (r.group_name ?? 'Sin grupo') !== group) return false;
    if (filter) {
      const needle = filter.toLowerCase();
      if (!`${r.first_name} ${r.last_name}`.toLowerCase().includes(needle)) return false;
    }
    return true;
  };

  const counts = rows.reduce((acc, r) => {
    const v = values[r.person_id];
    acc.total++;
    if (v.state !== '') acc.done++;
    if (r.hours_role && v.state === '') acc.missingHours++;
    return acc;
  }, { total: 0, done: 0, missingHours: 0 });

  const markAllYes = () => setValues((v) => {
    const next = { ...v };
    for (const r of rows) if (visible(r) && next[r.person_id].state === '' && !r.hours_role) next[r.person_id] = { ...next[r.person_id], state: 'si' };
    return next;
  });

  return (
    <PendingProvider pending={pending}>
      <form onSubmit={onSubmit}>
        <input type="hidden" name="mes" value={mes} />
        <div className="toolbar">
          <input type="search" placeholder="Buscar persona" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Grupo">
            <option value="">Todos los grupos</option>
            {groups.map((g) => <option key={g}>{g}</option>)}
          </select>
          <label className="inline"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Solo sin informe</label>
          <span className="muted">{counts.done} de {counts.total} con informe{counts.missingHours ? ` · ${counts.missingHours} PR/PAI/PA sin horas` : ''}</span>
          {canEdit ? <button type="button" className="btn-secondary" onClick={markAllYes} title="Solo a quienes no son PR/PAI/PA y aún no tienen informe">Marcar visibles “Sí”</button> : null}
        </div>

        <table className="table sheet">
          <thead>
            <tr><th>Persona</th><th>Grupo</th><th>Cargo del mes</th><th>¿Participó?</th><th className="num">Horas</th><th className="num" title="Cursos bíblicos (vacío = 0)">Cursos</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = values[r.person_id];
              const needsHours = !!r.hours_role && v.state !== '' && v.hours.trim() === '';
              return (
                <tr key={r.person_id} hidden={!visible(r)} className={v.state === '' ? 'row-missing' : undefined}>
                  <td>
                    <input type="hidden" name="person_id" value={r.person_id} />
                    <Link href={`/personas/${r.person_id}?anio=${anio}`}>{r.last_name}, {r.first_name}</Link>
                    {!r.is_active ? <span className="badge badge-muted">inactiva</span> : null}
                  </td>
                  <td>{r.group_name ?? '—'}</td>
                  <td>{r.hours_role ? <span className="badge badge-info">{r.hours_role}</span> : <span className="muted">—</span>}</td>
                  <td>
                    <div className="segmented" role="radiogroup" aria-label={`Participó ${r.first_name}`}>
                      {(['si', 'no', ''] as const).map((s) => (
                        <label key={s || 'none'} className={v.state === s ? 'on' : undefined}>
                          <input type="radio" name={`state_${r.person_id}`} value={s} checked={v.state === s}
                            disabled={!canEdit} onChange={() => set(r.person_id, { state: s })} />
                          {s === 'si' ? 'Sí' : s === 'no' ? 'No' : 'Sin informe'}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="num">
                    <input
                      name={`hours_${r.person_id}`} inputMode="decimal" className={`hours${needsHours ? ' invalid' : ''}`}
                      value={v.hours} disabled={!canEdit} placeholder={r.hours_role ? 'obligatorio' : ''}
                      onChange={(e) => {
                        const hours = e.target.value;
                        // Escribir horas > 0 implica que participó
                        set(r.person_id, Number(hours.replace(',', '.')) > 0 ? { hours, state: 'si' } : { hours });
                      }}
                    />
                  </td>
                  <td className="num">
                    <input
                      name={`studies_${r.person_id}`} inputMode="numeric" className="hours studies"
                      value={v.studies} disabled={!canEdit} placeholder="0" aria-label={`Cursos bíblicos ${r.first_name}`}
                      onChange={(e) => {
                        const studies = e.target.value;
                        // Informar cursos implica que participó
                        set(r.person_id, Number(studies) > 0 ? { studies, state: 'si' } : { studies });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {canEdit ? (
          <div className="sticky-actions">
            <SubmitButton>Guardar mes</SubmitButton>
            <FormMessage state={result} />
          </div>
        ) : null}
      </form>
    </PendingProvider>
  );
}

'use client';
import Link from 'next/link';
import { startTransition, useActionState, useRef, useState } from 'react';
import { importAction, type ImportState } from './actions';

const STATUS = { ok: ['Lista', 'badge-ok'], error: ['Error', 'badge-bad'], skip: ['Se omite', 'badge-muted'] } as const;

export function ImportForm() {
  const [state, dispatch, pending] = useActionState(importAction, {
    ok: true, message: '', fileErrors: [], rows: [], counts: null,
  } as ImportState);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<'revisar' | 'importar'>('revisar');
  const input = useRef<HTMLInputElement>(null);

  const send = (paso: 'revisar' | 'importar') => {
    if (!file) return;
    const fd = new FormData();
    fd.set('archivo', file);
    fd.set('paso', paso);
    setStep(paso);
    startTransition(() => dispatch(fd));
  };

  const imported = state.imported !== undefined;
  const canImport = !imported && state.ok && !!state.counts && state.counts.ok > 0 && state.counts.error === 0;

  return (
    <div className="stack">
      <div className="card stack">
        <div className="toolbar">
          <input
            ref={input} type="file" name="archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); }}
          />
          <button type="button" className="btn-secondary" disabled={!file || pending} onClick={() => send('revisar')}>
            {pending && step === 'revisar' ? 'Revisando…' : 'Revisar archivo'}
          </button>
          {canImport ? (
            <button type="button" className="btn" disabled={pending} onClick={() => send('importar')}>
              {pending && step === 'importar' ? 'Importando…' : `Importar ${state.counts!.ok} persona(s)`}
            </button>
          ) : null}
        </div>
        {state.message ? (
          <div className={`msg ${state.ok ? 'msg-ok' : 'msg-error'}`} role={state.ok ? 'status' : 'alert'}>
            {state.message}
            {state.fileErrors.length ? <ul>{state.fileErrors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            {imported ? <> <Link href="/personas">Ver personas</Link></> : null}
          </div>
        ) : null}
      </div>

      {state.rows.length ? (
        <div className="card">
          <h2>Vista previa</h2>
          {state.counts ? (
            <p className="muted">
              {state.counts.ok} lista(s) · {state.counts.error} con error · {state.counts.skip} se omite(n) porque ya existen
            </p>
          ) : null}
          <table className="table">
            <thead><tr><th className="num">Fila</th><th>Persona</th><th>Grupo</th><th>Cargos</th><th>Estado</th><th>Detalle</th></tr></thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.row}>
                  <td className="num">{r.row}</td>
                  <td>{r.name}</td>
                  <td>{r.group ?? '—'}</td>
                  <td>{r.roles || '—'}</td>
                  <td><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                  <td className="small">{r.messages.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

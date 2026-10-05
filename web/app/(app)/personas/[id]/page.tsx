import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { YearSelect } from '@/components/YearSelect';
import { Empty, PageHeader, Progress, ReadOnlyNote, StatusBadge } from '@/components/ui';
import { getPersonDetail, today } from '@/lib/services/persons';
import { listContactTypes, listDateTypes, listGroups, listMovementTypes, listRoles } from '@/lib/services/catalogs';
import { allowedMovementTypes } from '@/lib/services/movements';
import { goalCompliance } from '@/lib/services/metrics';
import { getSession } from '@/lib/services/session';
import { ServiceError, check } from '@/lib/services/errors';
import { fmtDate, fmtNum, fmtPct } from '@/lib/format';
import { MONTH_NAMES, lastClosedMonth, periodKey, serviceYearMonths } from '@/lib/service-year';
import { yearContext, type SearchParams } from '@/lib/page';
import type { HoursRoleMonth } from '@/lib/types';
import { PersonFields } from '../PersonFields';
import * as A from '../actions';

export default async function PersonaPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, sy, years } = await yearContext(searchParams);

  let detail;
  try {
    detail = await getPersonDetail(db, id, sy);
  } catch (e) {
    if (e instanceof ServiceError) notFound();
    throw e;
  }
  const [compliance, roleMonths, roles, groups, contactTypes, dateTypes, movementTypes, session] = await Promise.all([
    goalCompliance(db, sy, { personId: id }),
    db.from('view_hours_role_months').select('year, month, role_code').eq('person_id', id).eq('service_year', sy)
      .then((r) => check(r) as Pick<HoursRoleMonth, 'year' | 'month' | 'role_code'>[]),
    listRoles(db, { onlyActive: true }),
    listGroups(db, { onlyActive: true }),
    listContactTypes(db),
    listDateTypes(db),
    listMovementTypes(db, { onlyActive: true }),
    getSession(),
  ]);
  const { person: p, reports, movements } = detail;
  const lastMovement = movements[0];
  const nextTypes = allowedMovementTypes(movementTypes, p.is_active);
  const canEdit = !!session?.canEdit;
  const months = serviceYearMonths(sy);
  const reportOf = new Map(reports.map((r) => [periodKey(r), r]));
  const roleOf = new Map(roleMonths.map((r) => [periodKey(r), r.role_code]));
  const closed = periodKey(lastClosedMonth());
  const defaultMonth = months.map(periodKey).filter((k) => k <= closed).pop() ?? periodKey(months[0]);

  return (
    <>
      <PageHeader title={`${p.first_name} ${p.last_name}`}>
        {!p.is_active ? (
          <span className="badge badge-muted">
            Inactiva{lastMovement ? ` desde ${fmtDate(lastMovement.movement_date)} · ${lastMovement.type_name}` : ''}
          </span>
        ) : null}
        <YearSelect value={sy} options={years} />
      </PageHeader>
      {!canEdit ? <ReadOnlyNote /> : null}

      <section className="grid-2">
        <div className="card">
          <h2>Metas del año {sy}</h2>
          {compliance.length === 0 ? <Empty>No tuvo cargo PR ni PA en este año de servicio.</Empty> : compliance.map((c) => (
            <div key={c.role_code} className="goal">
              <div className="goal-head"><strong>{c.role_code}</strong> <StatusBadge status={c.status} /></div>
              <Progress value={c.pct_goal} />
              <dl className="facts">
                <dt>Horas</dt><dd>{fmtNum(c.hours_done)} de {fmtNum(c.goal_hours)} ({fmtPct(c.pct_goal)})</dd>
                <dt>Meta a la fecha</dt><dd>{fmtNum(c.goal_to_date)} h ({fmtPct(c.pct_to_date)})</dd>
                <dt>Faltan</dt><dd>{fmtNum(c.hours_remaining)} h{c.hours_needed_per_month !== null ? ` · ${fmtNum(c.hours_needed_per_month)} h/mes` : ''}</dd>
                <dt>Informes faltantes</dt><dd>{c.months_missing}</dd>
              </dl>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Informes del año {sy}</h2>
          <table className="table compact">
            <thead><tr><th>Mes</th><th>Cargo</th><th>Participó</th><th className="num">Horas</th><th className="num">Cursos</th></tr></thead>
            <tbody>
              {months.map((m) => {
                const k = periodKey(m);
                const r = reportOf.get(k);
                const role = roleOf.get(k);
                const future = k > closed;
                return (
                  <tr key={k} className={!r && !future ? 'row-missing' : undefined}>
                    <td>{MONTH_NAMES[m.month - 1]} {m.year}</td>
                    <td>{role ?? '—'}</td>
                    <td>{r ? (r.participated ? 'Sí' : 'No') : <span className="muted">{future ? '' : 'Sin informe'}</span>}</td>
                    <td className="num">{r?.hours ?? ''}</td>
                    <td className="num">{r ? r.bible_studies : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canEdit ? (
            <ActionForm action={A.saveReportAction} className="inline-form">
              <input type="hidden" name="person_id" value={id} />
              <select name="mes" defaultValue={defaultMonth} aria-label="Mes">
                {months.map((m) => <option key={periodKey(m)} value={periodKey(m)}>{MONTH_NAMES[m.month - 1]} {m.year}</option>)}
              </select>
              <select name="state" defaultValue="si" aria-label="Participó">
                <option value="si">Participó</option><option value="no">No participó</option><option value="">Borrar informe</option>
              </select>
              <input name="hours" inputMode="decimal" placeholder="Horas" className="hours" aria-label="Horas" />
              <input name="studies" inputMode="numeric" placeholder="Cursos" className="hours studies" aria-label="Cursos bíblicos" />
              <SubmitButton className="btn-secondary">Guardar</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2>Altas, bajas y traslados</h2>
        {movements.length === 0 ? <Empty>Sin altas ni bajas registradas: cuenta como miembro en todos los meses.</Empty> : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Congregación</th><th>Notas</th><th></th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.movement_date)}</td>
                  <td><span className={`badge ${m.direction === 'ALTA' ? 'badge-ok' : 'badge-muted'}`}>{m.direction === 'ALTA' ? 'Alta' : 'Baja'}</span> {m.type_name}</td>
                  <td>{m.congregation ?? '—'}</td>
                  <td>{m.notes}</td>
                  <td>{canEdit ? (
                    <ActionForm action={A.deleteMovementAction}
                      confirm="¿Eliminar este registro? Úsalo solo para corregir errores. Los cargos y el grupo que cerró una baja no se reabren.">
                      <input type="hidden" name="person_id" value={id} /><input type="hidden" name="id" value={m.id} />
                      <SubmitButton className="btn-link danger" pendingText="…">Eliminar</SubmitButton>
                    </ActionForm>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <>
            <ActionForm action={A.addMovementAction} className="inline-form" resetOnSuccess
              confirm={p.is_active ? '¿Registrar la baja? Se cerrarán el cargo y el grupo vigentes el día anterior a la fecha.' : undefined}>
              <input type="hidden" name="person_id" value={id} />
              <select name="movement_type_id" required defaultValue="" aria-label="Motivo">
                <option value="" disabled>{p.is_active ? 'Motivo de la baja…' : 'Motivo del alta…'}</option>
                {nextTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <label className="inline">Fecha <input type="date" name="movement_date" required defaultValue={today()} max={today()} /></label>
              <input name="congregation" placeholder={p.is_active ? 'Congregación de destino' : 'Congregación de origen'} aria-label="Congregación" />
              <input name="notes" placeholder="Notas" aria-label="Notas" />
              <SubmitButton className="btn-secondary">{p.is_active ? 'Registrar baja' : 'Registrar alta'}</SubmitButton>
            </ActionForm>
            <p className="muted small">
              La fecha de una baja es el primer día en que ya no pertenece. Desde ese mes deja de contar en
              métricas e informes (el mes de la baja cuenta si estuvo al menos un día). La congregación es
              obligatoria en los traslados.
            </p>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Cargos</h2>
        {detail.roles.length === 0 ? <Empty>Sin cargos registrados.</Empty> : (
          <table className="table">
            <thead><tr><th>Cargo</th><th>Desde</th><th>Hasta</th><th></th></tr></thead>
            <tbody>
              {detail.roles.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.role_code}</strong> {r.role_name !== r.role_code ? r.role_name : ''} {r.is_current ? <span className="badge badge-info">vigente</span> : null}</td>
                  <td>{fmtDate(r.start_date)}</td>
                  <td>{r.end_date ? fmtDate(r.end_date) : canEdit ? (
                    <ActionForm action={A.closeRoleAction} className="inline-form">
                      <input type="hidden" name="person_id" value={id} /><input type="hidden" name="id" value={r.id} />
                      <input type="date" name="end_date" defaultValue={today()} required aria-label="Fecha de fin" />
                      <SubmitButton className="btn-secondary">Cerrar</SubmitButton>
                    </ActionForm>
                  ) : '—'}</td>
                  <td>{canEdit ? (
                    <ActionForm action={A.deleteRoleAction} confirm="¿Eliminar este periodo de cargo? Úsalo solo para corregir errores; para terminar un cargo, ciérralo.">
                      <input type="hidden" name="person_id" value={id} /><input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn-link danger" pendingText="…">Eliminar</SubmitButton>
                    </ActionForm>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <ActionForm action={A.addRoleAction} className="inline-form" resetOnSuccess>
            <input type="hidden" name="person_id" value={id} />
            <select name="role_id" required defaultValue="" aria-label="Cargo">
              <option value="" disabled>Cargo…</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
            </select>
            <label className="inline">Desde <input type="date" name="start_date" required defaultValue={today()} /></label>
            <label className="inline">Hasta <input type="date" name="end_date" /></label>
            <SubmitButton className="btn-secondary">Agregar cargo</SubmitButton>
          </ActionForm>
        ) : null}
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Grupos</h2>
          {detail.groups.length === 0 ? <Empty>Sin grupo.</Empty> : (
            <table className="table compact">
              <thead><tr><th>Grupo</th><th>Desde</th><th>Hasta</th><th></th></tr></thead>
              <tbody>
                {detail.groups.map((g) => (
                  <tr key={g.id}>
                    <td>{g.catalog_groups?.name}</td>
                    <td>{fmtDate(g.start_date)}</td>
                    <td>{g.end_date ? fmtDate(g.end_date) : canEdit ? (
                      <ActionForm action={A.closeGroupAction} className="inline-form">
                        <input type="hidden" name="person_id" value={id} /><input type="hidden" name="id" value={g.id} />
                        <input type="date" name="end_date" defaultValue={today()} required aria-label="Fecha de fin" />
                        <SubmitButton className="btn-secondary">Cerrar</SubmitButton>
                      </ActionForm>
                    ) : 'vigente'}</td>
                    <td>{canEdit ? (
                      <ActionForm action={A.deleteGroupAction} confirm="¿Eliminar este periodo de grupo?">
                        <input type="hidden" name="person_id" value={id} /><input type="hidden" name="id" value={g.id} />
                        <SubmitButton className="btn-link danger" pendingText="…">Eliminar</SubmitButton>
                      </ActionForm>
                    ) : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canEdit ? (
            <ActionForm action={A.addGroupAction} className="inline-form" resetOnSuccess>
              <input type="hidden" name="person_id" value={id} />
              <select name="group_id" required defaultValue="" aria-label="Grupo">
                <option value="" disabled>Cambiar a grupo…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <label className="inline">Desde <input type="date" name="start_date" required defaultValue={today()} /></label>
              <SubmitButton className="btn-secondary">Asignar</SubmitButton>
            </ActionForm>
          ) : null}
          {canEdit ? <p className="muted small">Al asignar un grupo nuevo, el grupo vigente se cierra el día anterior.</p> : null}
        </div>

        <div className="card">
          <h2>Contactos y fechas</h2>
          {detail.contacts.length === 0 && detail.dates.length === 0 ? <Empty>Sin contactos ni fechas.</Empty> : null}
          <ul className="plain">
            {detail.contacts.map((c) => (
              <li key={c.id}>
                <span className="muted">{c.catalog_contact_types?.name}:</span> {c.value} {c.is_primary ? <span className="badge badge-info">principal</span> : null}
                {canEdit ? (
                  <ActionForm action={A.deleteContactAction} className="inline-form right">
                    <input type="hidden" name="person_id" value={id} /><input type="hidden" name="id" value={c.id} />
                    <SubmitButton className="btn-link danger" pendingText="…">Quitar</SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
            {detail.dates.map((d) => (
              <li key={d.id}>
                <span className="muted">{d.catalog_date_types?.name}:</span> {fmtDate(d.date_value)}
                {canEdit ? (
                  <ActionForm action={A.deleteDateAction} className="inline-form right">
                    <input type="hidden" name="person_id" value={id} /><input type="hidden" name="id" value={d.id} />
                    <SubmitButton className="btn-link danger" pendingText="…">Quitar</SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <>
              <ActionForm action={A.addContactAction} className="inline-form" resetOnSuccess>
                <input type="hidden" name="person_id" value={id} />
                <select name="contact_type_id" required defaultValue="" aria-label="Tipo de contacto">
                  <option value="" disabled>Contacto…</option>
                  {contactTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input name="value" required placeholder="Valor" aria-label="Valor" />
                <label className="inline"><input type="checkbox" name="is_primary" /> Principal</label>
                <SubmitButton className="btn-secondary">Agregar</SubmitButton>
              </ActionForm>
              <ActionForm action={A.setDateAction} className="inline-form" resetOnSuccess>
                <input type="hidden" name="person_id" value={id} />
                <select name="date_type_id" required defaultValue="" aria-label="Tipo de fecha">
                  <option value="" disabled>Fecha…</option>
                  {dateTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input type="date" name="date_value" required aria-label="Fecha" />
                <SubmitButton className="btn-secondary">Guardar</SubmitButton>
              </ActionForm>
            </>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2>Datos personales</h2>
        <ActionForm action={A.updatePersonAction} className="stack">
          <input type="hidden" name="id" value={id} />
          <PersonFields p={p} disabled={!canEdit} />
          {canEdit ? <div><SubmitButton>Guardar datos</SubmitButton></div> : null}
        </ActionForm>
        {canEdit ? (
          <ActionForm action={A.deletePersonAction} className="danger-zone"
            confirm="¿Eliminar a esta persona? Solo se puede si se capturó por error y no tiene informes, cargos, grupos ni altas/bajas. Si dejó la congregación, registra una baja.">
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="btn-link danger" pendingText="Eliminando…">Eliminar persona</SubmitButton>
          </ActionForm>
        ) : null}
      </section>

      <p><Link href="/personas">← Volver a personas</Link></p>
    </>
  );
}

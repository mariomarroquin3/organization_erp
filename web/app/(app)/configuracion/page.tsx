import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Empty, PageHeader, ReadOnlyNote } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { listGoals, listGroups, listRoles } from '@/lib/services/catalogs';
import { can, requireAreaPage } from '@/lib/services/session';
import { currentServiceYear } from '@/lib/service-year';
import { fmtNum } from '@/lib/format';
import * as A from './actions';

export default async function ConfiguracionPage() {
  const session = await requireAreaPage('CONFIGURACION');
  const db = await createClient();
  const [groups, roles, goals] = await Promise.all([listGroups(db), listRoles(db), listGoals(db)]);
  const canEdit = can(session, 'CONFIGURACION', 'edit');
  const hoursRoles = roles.filter((r) => r.requires_hours_report);

  return (
    <>
      <PageHeader title="Configuración" />
      {!canEdit ? <ReadOnlyNote /> : null}

      <section className="card">
        <h2>Metas de horas</h2>
        <p className="muted small">
          Una meta aplica desde su año de servicio hasta que se registre otra más reciente para el mismo cargo.
          La meta anual se prorratea por los meses con el cargo; la mensual se exige por cada mes con el cargo.
        </p>
        {goals.length === 0 ? <Empty>No hay metas.</Empty> : (
          <table className="table">
            <thead><tr><th>Cargo</th><th>Desde año de servicio</th><th className="num">Anual (h)</th><th className="num">Mensual (h)</th><th>Notas</th><th></th></tr></thead>
            <tbody>
              {goals.map((g) => (
                <tr key={g.id}>
                  <td><strong>{g.catalog_roles?.code}</strong></td>
                  <td>{g.effective_from_sy}</td>
                  <td className="num">{fmtNum(g.annual_hours)}</td>
                  <td className="num">{fmtNum(g.monthly_hours)}</td>
                  <td>{g.notes}</td>
                  <td>{canEdit ? (
                    <ActionForm action={A.deleteGoalAction} confirm="¿Eliminar esta meta?">
                      <input type="hidden" name="id" value={g.id} />
                      <SubmitButton className="btn-link danger" pendingText="…">Eliminar</SubmitButton>
                    </ActionForm>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <ActionForm action={A.saveGoalAction} className="inline-form" resetOnSuccess>
            <select name="role_id" required defaultValue="" aria-label="Cargo">
              <option value="" disabled>Cargo…</option>
              {hoursRoles.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </select>
            <label className="inline">Desde <input name="effective_from_sy" type="number" min={2000} max={2100} defaultValue={currentServiceYear()} className="short" /></label>
            <input name="annual_hours" inputMode="decimal" placeholder="Anual (h)" className="short" aria-label="Meta anual" />
            <input name="monthly_hours" inputMode="decimal" placeholder="Mensual (h)" className="short" aria-label="Meta mensual" />
            <input name="notes" placeholder="Notas" aria-label="Notas" />
            <SubmitButton className="btn-secondary">Agregar meta</SubmitButton>
          </ActionForm>
        ) : null}
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Grupos</h2>
          <table className="table compact">
            <thead><tr><th>Nombre</th><th>Descripción</th><th>Activo</th>{canEdit ? <th></th> : null}</tr></thead>
            <tbody>
              {groups.map((g) => canEdit ? (
                <tr key={g.id}>
                  <td colSpan={4}>
                    <ActionForm action={A.saveGroupAction} className="inline-form">
                      <input type="hidden" name="id" value={g.id} />
                      <input name="name" defaultValue={g.name} required aria-label="Nombre" />
                      <input name="description" defaultValue={g.description ?? ''} placeholder="Descripción" aria-label="Descripción" />
                      <label className="inline"><input type="checkbox" name="is_active" defaultChecked={g.is_active} /> Activo</label>
                      <SubmitButton className="btn-secondary">Guardar</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ) : (
                <tr key={g.id}><td>{g.name}</td><td>{g.description}</td><td>{g.is_active ? 'Sí' : 'No'}</td></tr>
              ))}
            </tbody>
          </table>
          {canEdit ? (
            <ActionForm action={A.saveGroupAction} className="inline-form" resetOnSuccess>
              <input name="name" required placeholder="Nuevo grupo" aria-label="Nombre del grupo" />
              <input name="description" placeholder="Descripción" aria-label="Descripción" />
              <SubmitButton className="btn-secondary">Agregar</SubmitButton>
            </ActionForm>
          ) : null}
          <p className="muted small">
            Para mover personas entre grupos o disolver un grupo usa <Link href="/personas/reagrupar">Reagrupar</Link>; un grupo
            solo se puede desactivar cuando ya no tiene personas. El historial de cada mes conserva el grupo de entonces.
            Cambiar el nombre de un grupo también lo cambia en los informes pasados: úsalo solo para corregir.
          </p>
        </div>

        <div className="card">
          <h2>Cargos</h2>
          <p className="muted small">Los cargos “con horas” (PR, PAI, PA) informan horas y pueden tener meta; el resto solo informa si participó. Un cargo “por meses” (PA, de 1 a 3 meses) siempre lleva fecha de fin y al terminar deja su registro; PAI y PR siguen vigentes hasta que se cierren.</p>
          <table className="table compact">
            <tbody>
              {roles.map((r) => canEdit ? (
                <tr key={r.id}>
                  <td>
                    <ActionForm action={A.saveRoleAction} className="inline-form">
                      <input type="hidden" name="id" value={r.id} />
                      <input name="code" defaultValue={r.code} required className="short" aria-label="Código" />
                      <input name="name" defaultValue={r.name} required aria-label="Nombre" />
                      <input name="sort_order" type="number" defaultValue={r.sort_order} className="short" aria-label="Orden" />
                      <label className="inline"><input type="checkbox" name="requires_hours_report" defaultChecked={r.requires_hours_report} /> Con horas</label>
                      <label className="inline"><input type="checkbox" name="requires_end_date" defaultChecked={r.requires_end_date} /> Por meses</label>
                      <label className="inline">Máx. meses <input name="max_months" type="number" min={1} max={120} defaultValue={r.max_months ?? ''} className="short" /></label>
                      <label className="inline"><input type="checkbox" name="is_active" defaultChecked={r.is_active} /> Activo</label>
                      <SubmitButton className="btn-secondary">Guardar</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}><td><strong>{r.code}</strong> {r.name}{r.requires_hours_report ? ' · con horas' : ''}{r.requires_end_date ? ` · por meses${r.max_months ? ` (máx. ${r.max_months})` : ''}` : ''}{r.is_active ? '' : ' · inactivo'}</td></tr>
              ))}
            </tbody>
          </table>
          {canEdit ? (
            <ActionForm action={A.saveRoleAction} className="inline-form" resetOnSuccess>
              <input name="code" required placeholder="Código" className="short" aria-label="Código" />
              <input name="name" required placeholder="Nombre" aria-label="Nombre" />
              <input name="sort_order" type="number" defaultValue={100} className="short" aria-label="Orden" />
              <label className="inline"><input type="checkbox" name="requires_hours_report" /> Con horas</label>
              <label className="inline"><input type="checkbox" name="requires_end_date" /> Por meses</label>
              <label className="inline">Máx. meses <input name="max_months" type="number" min={1} max={120} className="short" /></label>
              <SubmitButton className="btn-secondary">Agregar</SubmitButton>
            </ActionForm>
          ) : null}
          <p className="muted small">Las métricas dependen de los códigos exactos PR, PAI y PA, y la regla del bautismo de PB y PNB: no los cambies. Quien recibe PB deja de ser PNB el día anterior y no puede volver a serlo.</p>
        </div>
      </section>
    </>
  );
}

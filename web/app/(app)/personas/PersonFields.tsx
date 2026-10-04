import type { Person } from '@/lib/types';

export function PersonFields({ p, disabled }: { p?: Person; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="form-grid">
      <label>Nombre<input name="first_name" required defaultValue={p?.first_name} /></label>
      <label>Apellidos<input name="last_name" required defaultValue={p?.last_name} /></label>
      <label>Fecha de nacimiento<input type="date" name="birth_date" defaultValue={p?.birth_date ?? ''} /></label>
      <label className="check"><input type="checkbox" name="is_active" defaultChecked={p ? p.is_active : true} /> Activa</label>
      <label className="span-2">Notas<textarea name="notes" rows={2} defaultValue={p?.notes ?? ''} /></label>
    </fieldset>
  );
}

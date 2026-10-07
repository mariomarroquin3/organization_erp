// Áreas de la app y permisos. Las mismas reglas se aplican en la base
// (migración 1200, RLS); aquí solo deciden qué se muestra.

export const AREAS = ['PERSONAS', 'MOVIMIENTOS', 'INFORMES', 'METRICAS', 'CONFIGURACION', 'USUARIOS'] as const;
export type Area = (typeof AREAS)[number];
export type Level = 'read' | 'edit';
export type AreaMap = Partial<Record<Area, Level>>;

export const AREA_INFO: Record<Area, { label: string; description: string; editable: boolean }> = {
  PERSONAS: { label: 'Personas', description: 'Fichas: datos, contactos, fechas, cargos y grupos', editable: true },
  MOVIMIENTOS: { label: 'Altas y bajas', description: 'Registrar altas, bajas y traslados', editable: true },
  INFORMES: { label: 'Informes del mes', description: 'Capturar participación, horas y cursos', editable: true },
  METRICAS: { label: 'Métricas', description: 'Panel, métricas, informe anual y exportes', editable: false },
  CONFIGURACION: { label: 'Configuración', description: 'Grupos, cargos y metas de horas', editable: true },
  USUARIOS: { label: 'Usuarios', description: 'Ver o crear cuentas y cambiar permisos (no da acceso a datos)', editable: true },
};

export const LEVEL_LABEL: Record<Level, string> = { read: 'Lectura', edit: 'Edición' };

export function isArea(v: string): v is Area {
  return (AREAS as readonly string[]).includes(v);
}

/** Normaliza un mapa que viene de la base o de un formulario. */
export function cleanAreaMap(raw: unknown): AreaMap {
  const out: AreaMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isArea(k) || (v !== 'read' && v !== 'edit')) continue;
    out[k] = v === 'edit' && AREA_INFO[k].editable ? 'edit' : 'read';
  }
  return out;
}

export function allows(areas: AreaMap, area: Area, need: Level = 'read') {
  const has = areas[area];
  return need === 'read' ? !!has : has === 'edit';
}

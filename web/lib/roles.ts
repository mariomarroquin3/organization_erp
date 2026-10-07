// Cargos con informe de horas. Las métricas de la base tratan igual a
// cualquier cargo "con horas"; aquí solo se fija el orden y la forma de
// explicar la meta de los tres que vienen de fábrica.
//   PR : meta anual, se prorratea por los meses con el cargo.
//   PAI: PA indefinido, 30 h cada mes (360 h el año completo).
//   PA : por meses concretos (siempre con fecha de fin), 30 h cada mes.

export const HOURS_ROLES = ['PR', 'PAI', 'PA'] as const;
export type HoursRoleCode = (typeof HOURS_ROLES)[number];

export const HOURS_ROLE_TITLE: Record<HoursRoleCode, string> = {
  PR: 'PR (meta anual)',
  PAI: 'PAI (indefinido, meta mensual)',
  PA: 'PA (por meses)',
};

export const HOURS_ROLES_LABEL = 'PR / PAI / PA';

/** Nota sobre cómo se calcula la meta de cada cargo, igual en pantalla y archivos. */
export const GOAL_RULES_NOTE =
  'La meta de PR se prorratea por los meses con el cargo; la de PAI y PA es por cada mes con el cargo '
  + '(PAI sigue vigente hasta que se cierre; PA es solo por los meses indicados).';

/** Orden de presentación: PR, PAI, PA y después cualquier otro cargo con horas. */
export function hoursRoleRank(code: string): number {
  const i = (HOURS_ROLES as readonly string[]).indexOf(code);
  return i < 0 ? HOURS_ROLES.length : i;
}

export function compareHoursRoles(a: string, b: string): number {
  return hoursRoleRank(a) - hoursRoleRank(b) || a.localeCompare(b);
}

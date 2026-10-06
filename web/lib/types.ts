// Tipos de las filas que devuelven las tablas, vistas y funciones de
// supabase/migrations. Se mantienen a mano: si cambia una vista,
// actualizar aquí.

export type SystemRole = 'SUPERADMIN' | 'USER';

export type ComplianceStatus = 'CUMPLIDA' | 'AL DIA' | 'ATRASADO' | 'NO CUMPLIDA' | 'SIN META';

export interface CatalogGroup { id: string; name: string; description: string | null; is_active: boolean }

export interface CatalogRole {
  id: string; code: string; name: string;
  requires_hours_report: boolean; is_active: boolean; sort_order: number;
}

export interface CatalogType { id: string; code: string; name: string }

export interface Person {
  id: string; first_name: string; last_name: string;
  birth_date: string | null; is_active: boolean; notes: string | null;
}

export interface PersonOverview {
  person_id: string; first_name: string; last_name: string; is_active: boolean; birth_date: string | null;
  group_id: string | null; group_name: string | null;
  current_roles: string | null; current_hours_role: string | null;
  last_movement_type: string | null; last_movement_date: string | null;
}

export interface RoleHistoryRow {
  id: string; person_id: string; role_code: string; role_name: string;
  requires_hours_report: boolean; start_date: string; end_date: string | null; is_current: boolean;
}

export interface GroupHistoryRow {
  id: string; person_id: string; group_id: string; start_date: string; end_date: string | null;
  catalog_groups: { name: string } | null;
}

export interface PersonContact {
  id: string; person_id: string; contact_type_id: string; value: string; is_primary: boolean;
  catalog_contact_types: { name: string } | null;
}

export interface PersonDate {
  id: string; person_id: string; date_type_id: string; date_value: string;
  catalog_date_types: { name: string } | null;
}

export interface MonthlyReport {
  id: string; person_id: string; year: number; month: number;
  participated: boolean; hours: number | null; bible_studies: number; notes: string | null; service_year: number;
}

export interface HoursRoleMonth {
  person_id: string; period: string; year: number; month: number; service_year: number;
  role_id: string; role_code: string; role_name: string; monthly_goal: number | null; is_closed: boolean;
}

export interface GoalCompliance {
  person_id: string; first_name: string; last_name: string;
  service_year: number; role_code: string; role_name: string;
  months_in_role: number; months_closed: number; months_reported: number; months_missing: number;
  goal_hours: number | null; goal_to_date: number | null; hours_done: number;
  hours_remaining: number | null; pct_goal: number | null; pct_to_date: number | null;
  hours_needed_per_month: number | null; status: ComplianceStatus;
}

export interface ReportMatrixRow {
  person_id: string; first_name: string; last_name: string; group_name: string | null;
  period: string; year: number; month: number; hours_role: string | null;
  has_report: boolean; participated: boolean; hours: number | null; bible_studies: number;
}

export interface ServiceYearSummary {
  person_id: string; first_name: string; last_name: string; group_name: string | null;
  current_roles: string | null; months_expected: number; months_reported: number;
  months_participated: number; pct_reported: number | null; pct_participated: number | null;
  total_hours: number;
}

export interface MonthlySummary {
  period: string; group_name: string | null; persons: number; reports_received: number;
  participated: number; pct_reported: number | null; hours_role_persons: number; total_hours: number;
  bible_studies: number;
}

export interface RoleHourGoal {
  id: string; role_id: string; effective_from_sy: number;
  annual_hours: number | null; monthly_hours: number | null; notes: string | null;
  catalog_roles: { code: string; name: string } | null;
}

export type MovementDirection = 'ALTA' | 'BAJA';

export interface MovementType {
  id: string; code: string; name: string; direction: MovementDirection;
  requires_congregation: boolean; is_active: boolean; sort_order: number;
}

export interface PersonMovement {
  id: string; person_id: string; first_name: string; last_name: string;
  movement_type_id: string; type_code: string; type_name: string; direction: MovementDirection;
  movement_date: string; service_year: number; congregation: string | null; notes: string | null;
}

/** Periodo en que la persona era miembro. Fechas inclusivas; null = sin límite. */
export interface MembershipPeriod { person_id: string; start_date: string | null; end_date: string | null }

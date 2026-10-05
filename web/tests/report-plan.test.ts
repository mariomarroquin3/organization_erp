import { describe, expect, it } from 'vitest';
import { parseHours, parseStudies, planMonthSave, type PersonInfo } from '@/lib/services/report-plan';

const people = new Map<string, PersonInfo>([
  ['pr', { name: 'Ana López', hoursRole: 'PR' }],
  ['pb', { name: 'Carla Méndez', hoursRole: null }],
  ['x', { name: 'Diego Paz', hoursRole: null }],
]);

describe('parseHours', () => {
  it('acepta coma decimal y rechaza basura o > 744', () => {
    expect(parseHours('')).toBeNull();
    expect(parseHours('12,5')).toBe(12.5);
    expect(parseHours('0')).toBe(0);
    expect(parseHours('-1')).toBe('invalid');
    expect(parseHours('abc')).toBe('invalid');
    expect(parseHours('745')).toBe('invalid');
  });
});

describe('planMonthSave', () => {
  it('inserta, actualiza y borra solo lo que cambió', () => {
    const plan = planMonthSave(2026, 3, [
      { person_id: 'pr', state: 'si', hours: '50' },  // igual que antes: no se toca
      { person_id: 'pb', state: 'no', hours: '' },    // cambia de sí a no
      { person_id: 'x', state: '', hours: '' },       // se borra
    ], [
      { id: 'r1', person_id: 'pr', participated: true, hours: 50, bible_studies: 0 },
      { id: 'r2', person_id: 'pb', participated: true, hours: null, bible_studies: 0 },
      { id: 'r3', person_id: 'x', participated: false, hours: null, bible_studies: 0 },
    ], people);
    expect(plan.errors).toEqual([]);
    expect(plan.upserts).toEqual([{ person_id: 'pb', year: 2026, month: 3, participated: false, hours: null, bible_studies: 0 }]);
    expect(plan.deletes).toEqual(['r3']);
  });

  it('exige horas a PR/PA y participación si hay horas', () => {
    const plan = planMonthSave(2026, 3, [
      { person_id: 'pr', state: 'si', hours: '' },
      { person_id: 'pb', state: 'no', hours: '3' },
      { person_id: 'x', state: '', hours: '2' },
    ], [], people);
    expect(plan.upserts).toEqual([]);
    expect(plan.errors).toHaveLength(3);
    expect(plan.errors[0]).toMatch(/Ana López: era PR/);
  });

  it('PR con 0 horas y "no" es válido; horas opcionales para el resto', () => {
    const plan = planMonthSave(2026, 3, [
      { person_id: 'pr', state: 'no', hours: '0' },
      { person_id: 'pb', state: 'si', hours: '4' },
    ], [], people);
    expect(plan.errors).toEqual([]);
    expect(plan.upserts.map((u) => [u.person_id, u.participated, u.hours])).toEqual([['pr', false, 0], ['pb', true, 4]]);
  });

  it('cursos bíblicos: vacío es 0, cambiar solo los cursos actualiza, y exigen participación', () => {
    const prev = [{ id: 'r1', person_id: 'pb', participated: true, hours: null, bible_studies: 0 }];
    expect(planMonthSave(2026, 3, [{ person_id: 'pb', state: 'si', hours: '', studies: '' }], prev, people).upserts).toEqual([]);
    expect(planMonthSave(2026, 3, [{ person_id: 'pb', state: 'si', hours: '', studies: '2' }], prev, people).upserts)
      .toEqual([{ person_id: 'pb', year: 2026, month: 3, participated: true, hours: null, bible_studies: 2 }]);
    const bad = planMonthSave(2026, 3, [
      { person_id: 'pb', state: 'no', hours: '', studies: '1' },
      { person_id: 'x', state: '', hours: '', studies: '1' },
      { person_id: 'pr', state: 'si', hours: '10', studies: '1,5' },
    ], [], people);
    expect(bad.errors).toHaveLength(3);
    expect(bad.errors[2]).toMatch(/cursos bíblicos no válidos/);
  });

  it('parseStudies', () => {
    expect(parseStudies(undefined)).toBe(0);
    expect(parseStudies(' 3 ')).toBe(3);
    expect(parseStudies('100')).toBe('invalid');
    expect(parseStudies('-1')).toBe('invalid');
  });

  it('rechaza personas que no están en la hoja', () => {
    expect(planMonthSave(2026, 3, [{ person_id: 'otra', state: 'si', hours: '' }], [], people).errors).toHaveLength(1);
  });
});

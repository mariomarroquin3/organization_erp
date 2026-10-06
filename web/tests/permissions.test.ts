import { describe, expect, it } from 'vitest';
import { allows, cleanAreaMap } from '@/lib/permissions';

describe('cleanAreaMap', () => {
  it('descarta áreas y niveles desconocidos', () => {
    expect(cleanAreaMap({ PERSONAS: 'edit', USUARIOS: 'edit', INFORMES: 'all' })).toEqual({ PERSONAS: 'edit' });
  });
  it('Métricas solo se lee', () => {
    expect(cleanAreaMap({ METRICAS: 'edit' })).toEqual({ METRICAS: 'read' });
  });
  it('tolera valores vacíos', () => {
    expect(cleanAreaMap(null)).toEqual({});
  });
});

describe('allows', () => {
  const areas = cleanAreaMap({ PERSONAS: 'read', INFORMES: 'edit' });
  it('lectura basta para leer; edición implica lectura', () => {
    expect(allows(areas, 'PERSONAS')).toBe(true);
    expect(allows(areas, 'INFORMES')).toBe(true);
  });
  it('lectura no permite editar', () => {
    expect(allows(areas, 'PERSONAS', 'edit')).toBe(false);
    expect(allows(areas, 'INFORMES', 'edit')).toBe(true);
  });
  it('sin el área no hay acceso', () => {
    expect(allows(areas, 'CONFIGURACION')).toBe(false);
  });
});

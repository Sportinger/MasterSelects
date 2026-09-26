import { describe, expect, it } from 'vitest';
import { EFFECT_REGISTRY } from '../../src/effects';
import { EFFECT_OPERATORS } from '../../src/services/operators/operatorRegistry';
import { listNodeCatalog } from '../../src/services/operators/operatorCatalog';

describe('registry-derived operator matrix', () => {
  it('derives execution and family facts from shared operator definitions', () => {
    const catalog = listNodeCatalog();
    const subtract = catalog.find(entry => entry.id === 'math.subtract.rgb');
    expect(subtract).toMatchObject({ family: 'math.subtract', variant: 'rgb', backend: 'builtin', fusion: 'inline', state: 'stateless', invalidation: 'appearance' });
    expect(subtract?.localImplementations).toEqual([]);
    expect(subtract?.implementation).toBe('unknown');
    expect(subtract?.users).toContain('Local image graphs');
    expect(EFFECT_OPERATORS.find(operator => operator.id === subtract?.id)?.fusion).toBe(subtract?.fusion);
    expect(catalog.find(entry => entry.id === 'math.multiply.audio-scalar')).toMatchObject({
      family: 'math.multiply', variant: 'audio-scalar', context: 'Audio samples', implementation: 'shared', users: ['audio'],
    });
  });

  it('reports registered effect backends and remaining local implementations without a second inventory', () => {
    const catalog = listNodeCatalog();
    for (const effect of EFFECT_REGISTRY.values()) {
      const entry = catalog.find(candidate => candidate.id === `effect:${effect.id}`);
      expect(entry?.backend).toBe(effect.pipelineKind ?? 'fullscreen');
      // Feedback and source-history effects both read earlier frames.
      const history = ('usesFeedback' in effect && effect.usesFeedback) || ('usesInputHistory' in effect && effect.usesInputHistory);
      expect(entry?.state).toBe(history ? 'frame-history' : 'stateless');
      expect(entry?.localImplementations).toEqual([`Effect registry: ${effect.id}`]);
    }
  });

  it('exposes real signal formats and numeric ranges where registries define them', () => {
    const catalog = listNodeCatalog();
    expect(catalog.find(entry => entry.id === 'math.subtract.rgb')?.inputs[0].contract?.formats).toContain('source-rgb');
    expect(catalog.find(entry => entry.id === 'math.subtract.rgb')?.inputs[0].formats).toContain('source-rgb');
    expect(catalog.find(entry => entry.id === 'values.number')?.parameters[0]).toMatchObject({ min: -30, max: 30, step: 0.01 });
    expect(catalog.find(entry => entry.id === 'values.number')?.parameters[0]).toMatchObject({ unit: 'unknown', format: 'unknown' });
  });

  it('explicitly marks metadata that its owning registry has not declared', () => {
    for (const entry of listNodeCatalog()) {
      expect(['shared', 'local', 'unknown']).toContain(entry.implementation);
      for (const port of [...entry.inputs, ...entry.outputs]) expect(port.formats).toEqual(port.contract?.formats ?? []);
      for (const parameter of entry.parameters) expect(parameter).toMatchObject({ unit: expect.any(String), format: expect.any(String) });
    }
  });
});

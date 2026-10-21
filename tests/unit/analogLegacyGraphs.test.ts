import { describe, expect, it } from 'vitest';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { createLegacyCrtScreenGraph } from '../../src/services/operators/legacyCrtScreenGraph';
import { createLegacyGlitchGraph } from '../../src/services/operators/legacyGlitchGraph';
import { createLegacyFilmPrismGraph } from '../../src/services/operators/legacyFilmPrismGraph';
import { createDefaultCrtScreenGraph } from '../../src/services/operators/crtScreenRecipe';
import { createDefaultGlitchGraph } from '../../src/services/operators/glitchRecipe';
import { createDefaultFilmPrismGraph } from '../../src/services/operators/filmPrismRecipe';
import { createLegacyHoloGraph } from '../../src/services/operators/legacyHoloGraph';
import { createLegacyRibbonScanGraph } from '../../src/services/operators/legacyRibbonScanGraph';
import { createDefaultHoloGraph } from '../../src/services/operators/holoRecipe';
import { createDefaultRibbonScanGraph } from '../../src/services/operators/ribbonScanRecipe';
import { organizeEffectFamilyGraph } from '../../src/services/operators/effectFamilyPresentation';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { imageHashPcg2d } from '../../src/services/operators/imageHashPcg';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { operatorFamilyChoiceLabel, operatorVariantLabel } from '../../src/services/operators/operatorTaxonomy';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const CASES: Array<{ type: Effect['type']; saved: Effect['params']; original: () => EffectOperatorGraph; recipe: () => EffectOperatorGraph;
  recipeOnly: string[]; retired?: string[] }> = [
  { type: 'crt-screen', saved: { scale: 3, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 1 },
    original: createLegacyCrtScreenGraph, recipe: createDefaultCrtScreenGraph, recipeOnly: ['lineCount', 'curvature', 'maskSize'] },
  { type: 'glitch', saved: { scale: 14, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 1 },
    original: createLegacyGlitchGraph, recipe: createDefaultGlitchGraph, recipeOnly: ['density', 'bands', 'split'] },
  { type: 'film-prism', saved: { scale: 14, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 1 },
    original: createLegacyFilmPrismGraph, recipe: createDefaultFilmPrismGraph, recipeOnly: ['grain', 'grainSize', 'angle'] },
  { type: 'holo', saved: { scale: 14, amount: .75, angle: 0, colorA: '#22d3ee', colorB: '#f472b6', speed: 1 },
    original: createLegacyHoloGraph, recipe: createDefaultHoloGraph, recipeOnly: ['stripes'], retired: ['scale', 'angle'] },
  { type: 'ribbon-scan', saved: { scale: 14, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 1 },
    original: createLegacyRibbonScanGraph, recipe: createDefaultRibbonScanGraph, recipeOnly: ['edges'] },
];
const effect = (type: Effect['type'], params: Effect['params'], operatorGraph?: EffectOperatorGraph): Effect =>
  ({ id: `${type}-1`, name: type, type, enabled: true, params, ...(operatorGraph ? { operatorGraph } : {}) });
const shown = (instance: Effect) => Object.entries(effectParamDefinitions(instance)).filter(([, definition]) => !definition.hidden).map(([name]) => name);

describe('rebuilt analog effects keep the look they were saved with', () => {
  for (const { type, saved, original, recipe, recipeOnly, retired = ['colorA', 'colorB'] } of CASES) {
    it(`${type}: a graph-less effect from before the rebuild loads the frozen original graph and shows its original controls`, () => {
      const loaded = migratePersistedEffectOperatorGraph(effect(type, saved));
      expect(matchesEffectRecipe(loaded.operatorGraph!, original())).toBe(true);
      const controls = shown(loaded);
      for (const name of recipeOnly) expect(controls).not.toContain(name);
      expect(controls).toContain('amount');
    });

    it(`${type}: a new effect (every default parameter) gets the 2026-10 recipe and its controls`, () => {
      const loaded = migratePersistedEffectOperatorGraph(effect(type, getDefaultParams(type)));
      expect(matchesEffectRecipe(loaded.operatorGraph!, recipe())).toBe(true);
      const controls = shown(loaded);
      for (const name of recipeOnly) expect(controls).toContain(name);
      for (const name of retired) expect(controls).not.toContain(name);
    });

    it(`${type}: a saved original graph stays as saved even with new parameters present`, () => {
      const loaded = migratePersistedEffectOperatorGraph(effect(type, getDefaultParams(type), original()));
      expect(matchesEffectRecipe(loaded.operatorGraph!, original())).toBe(true);
    });
  }

  it('opens a saved original CRT Screen graph with the stage folders it had before the rebuild', () => {
    const graph = createLegacyCrtScreenGraph();
    const organized = organizeEffectFamilyGraph(graph, recognizeOperatorCompositions(graph), 'crt-screen', createDefaultCrtScreenGraph);
    expect(organized.groups?.map(group => group.label)).toEqual(expect.arrayContaining(['Clamped Image Sampling', 'Scanlines', 'Timeline Flicker', 'Color Mix & Sampled Alpha']));
    const current = createDefaultCrtScreenGraph();
    expect(organizeEffectFamilyGraph(current, recognizeOperatorCompositions(current), 'crt-screen', createDefaultCrtScreenGraph).groups?.map(group => group.label))
      .toEqual(expect.arrayContaining(['Scanline Beams', 'Phosphor Mask']));
  });

  it('shows retired parameters again where an original graph still reads them', () => {
    const crt = migratePersistedEffectOperatorGraph(effect('crt-screen', CASES[0].saved));
    expect(shown(crt)).toContain('scale');
    expect(shown(migratePersistedEffectOperatorGraph(effect('crt-screen', getDefaultParams('crt-screen'))))).not.toContain('scale');
  });
});

describe('integer PCG hash', () => {
  /** lowbias32 pre-mix + PCG2D written with BigInt arithmetic modulo 2^32, independent of the Math.imul implementation. */
  function reference(x: number, y: number): number {
    const view = new DataView(new ArrayBuffer(8)); view.setFloat32(0, x, true); view.setFloat32(4, y, true);
    const m = 2n ** 32n, mul = 1664525n, inc = 1013904223n;
    const spread = (value: bigint, factor: bigint) => { let v = value ^ (value >> 16n); v = (v * factor) % m; return v ^ (v >> 15n); };
    let a = (spread(BigInt(view.getUint32(0, true)), 0x7feb352dn) * mul + inc) % m, b = (spread(BigInt(view.getUint32(4, true)), 0x846ca68bn) * mul + inc) % m;
    a = (a + b * mul) % m; b = (b + a * mul) % m; a ^= a >> 16n; b ^= b >> 16n;
    a = (a + b * mul) % m; b = (b + a * mul) % m; a ^= a >> 16n;
    return Number(a >> 8n) / 16777216;
  }

  it('is offered in the node inspector as an algorithm choice of the Random node', () => {
    const sine = getEffectOperator('noise.hash2d.vec2')!, pcg = getEffectOperator('noise.hash2d-pcg.vec2')!;
    expect(sine.family).toBe(pcg.family);
    expect(operatorFamilyChoiceLabel(pcg.family)).toBe('Algorithm');
    expect([operatorVariantLabel(sine), operatorVariantLabel(pcg)]).toEqual(['Sine', 'Integer (PCG)']);
    expect(operatorVariantLabel(getEffectOperator('vector.split.vec2')!)).toBe('Vector 2');
  });

  it('matches the PCG2D reference on integer, fractional, negative and large keys', () => {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [12.37, -4.5], [36000.1, 97.25], [-0, 1e7], [508, 2244]]) expect(imageHashPcg2d([x, y])).toBe(reference(x, y));
  });

  it('is uniform without lattice stripes on a grid of cells', () => {
    const values = Array.from({ length: 128 * 128 }, (_, i) => imageHashPcg2d([i % 128, Math.floor(i / 128)]));
    const buckets = new Array(10).fill(0); for (const value of values) buckets[Math.floor(value * 10)]++;
    for (const count of buckets) expect(Math.abs(count / values.length - .1)).toBeLessThan(.01);
    // Neighbours along both axes and the diagonal are uncorrelated (the sine hash shows diagonal stripes).
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let sum = 0, count = 0;
      for (let y = 1; y < 127; y++) for (let x = 1; x < 127; x++) { sum += (values[y * 128 + x] - .5) * (values[(y + dy) * 128 + x + dx] - .5); count++; }
      expect(Math.abs(sum / count / (1 / 12))).toBeLessThan(.025);
    }
  });
});

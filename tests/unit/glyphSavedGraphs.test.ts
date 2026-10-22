// Glyph effects saved by 3.2.7 (packed node setups: Cell Grid, Tone to Glyph, Atlas Alpha, Clamped Image
// Sample and Sine Wave blocks) must open on the current engine and render exactly as they did. The fixture
// holds graphs and reference outputs written by the 3.2.7 code itself (CPU evaluator, fixed test atlas) for all
// nineteen looks, each at its defaults and tweaked (Cell Size 9, Amount 0.6, Invert Ramp, Duotone, Speed 2.5: the
// Tone to Glyph and roll paths). A tweaked look has the same stored setup with other values.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getOperatorComposition } from '../../src/services/operators/operatorCompositionRegistry';
import type { Effect } from '../../src/types/effects';

type Sample = { o: number[]; at: number[] };
type Saved = { saved: Effect; samples: Sample[]; tweaked: { params: Effect['params']; samples: Sample[] } };
const SAVED: Record<string, Saved> = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'glyph-graphs-saved-3.2.7.json'), 'utf8'));

/** The probe the fixture was written with: four pixels at four timeline times on a 1280 × 720 frame. */
function samples(effect: Effect): Sample[] {
  return [[.31, .47, 0], [.7, .2, 1.3], [.12, .88, 2.7], [.55, .61, 9.4]].map(([u, v, time]) => {
    const plan = compileImageOperatorGraph(effectOperatorGraph(effect), { ...effect.params }, { parameterSchema: getEffect(effect.type)!.params,
      resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .:-=+*#%@', cellSize: 64 }), allowFrameHistory: true });
    let at: number[] = [];
    const output = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [u, v], resolution: [1280, 720], timelineTimeSeconds: time, derivativeAutoMode: 'fine',
      pixelCoordinate: [Math.floor(u * 1280), Math.floor(v * 720)], sampleImage: (coords: number[]) => [coords[0], coords[1], .3, .5 + coords[0] / 2],
      sampleResource: (_id: string, coords: number[]) => { at = coords; return [0, 0, 0, (coords[0] * 7) % 1]; } }) as number[];
    return { o: output.map(value => +value.toFixed(5)), at: at.map(value => +value.toFixed(5)) };
  });
}

describe('glyph effects saved by 3.2.7', () => {
  const cases = Object.entries(SAVED).flatMap(([type, entry]) => [
    [`${type} (defaults)`, entry.saved, entry.samples] as const,
    [`${type} (tweaked)`, { ...entry.saved, params: entry.tweaked.params }, entry.tweaked.samples] as const,
  ]);

  it('covers all nineteen glyph looks', () => expect(Object.keys(SAVED)).toHaveLength(19));

  it.each(cases)('%s opens and renders as it did, also after saving it again', (_name, saved, expected) => {
    const loaded = migratePersistedEffectOperatorGraph(structuredClone(saved));
    expect(samples(loaded)).toEqual(expected);
    const resaved = migratePersistedEffectOperatorGraph(JSON.parse(JSON.stringify(loaded)));
    expect(samples(resaved)).toEqual(expected);
  });

  it('keeps the port ids of the glyph blocks that saved node setups wire (a graph edit must not rename them)', () => {
    const ports = (id: string) => {
      const body = getOperatorComposition(id)!.composition!;
      return { inputs: Object.keys(body.inputs), outputs: Object.keys(body.outputs), legacy: Object.keys(body.legacyInputs ?? {}) };
    };
    expect(ports('glyph.cell-grid')).toEqual({ inputs: ['safe-cell-pixels-value', 'resolution-value', 'uv-uv'],
      outputs: ['sample-uv-value', 'local-uv-value', 'safe-cell-value', 'safe-cell-vec2-value', 'grid-value', 'cell-id-value', 'half-vec2-value'],
      legacy: ['cell-size-value'] });
    expect(ports('glyph.tone-index')).toEqual({ inputs: ['tone-value', 'invert-value', 'atlas-glyphCount'], outputs: ['glyph-index-value', 'safe-count-value'], legacy: [] });
    expect(ports('glyph.atlas-alpha')).toEqual({ inputs: ['atlas-columns', 'atlas-rows', 'glyph-index-value', 'local-uv-value', 'atlas-image'],
      outputs: ['atlas-split-w'], legacy: ['tiny-vec2-value', 'almost-vec2-value'] });
  });
});

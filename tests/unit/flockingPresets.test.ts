// The Flocking effect's own presets (its card's Preset row) and the slider range of its promoted
// controls. Framing: the default scene camera shows about ±70 units vertically at the swarm's
// depth, so the card's swarms are bounded to stay in the picture (Free Swarm used to drift out of
// the top of the frame, Follow Path's figure eight ran off both edges, Violet Filaments spread
// over the whole frame).
import { describe, expect, it } from 'vitest';
import {
  FLOCKING_CARD_PRESET_IDS,
  FLOCK_PRESETS,
  createFlockPresetDefinition,
  getFlockPreset,
} from '../../src/services/flock/presets/flockPresets';
import { flockSliderRange } from '../../src/components/panels/properties/flock/flockControlUtils';
import { getFlockOperator } from '../../src/services/flock/operators/flockOperatorRegistry';
import type { FlockParamDescriptor } from '../../src/services/flock/operators/flockOperatorTypes';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';

const param = (operator: string, id: string): FlockParamDescriptor =>
  getFlockOperator(operator)!.params.find(candidate => candidate.id === id)!;

describe('Flocking presets', () => {
  it('compiles every card preset without warnings, with Technical Network and Violet Filaments held in frame', () => {
    for (const id of FLOCKING_CARD_PRESET_IDS) {
      const result = compileFlockDefinition(createFlockPresetDefinition(id));
      expect(result.ok, id).toBe(true);
      // A preset value past a node's limit makes the swarm invalid (Violet's 72-sample trails did, briefly).
      expect(result.diagnostics.filter(item => item.severity !== 'info'), id).toEqual([]);
    }
    const boundary = (id: string) => createFlockPresetDefinition(id).nodes.find(node => node.operator === 'flock.boundary')!.params;
    expect(boundary('technical-network')).toMatchObject({ mode: 'contain' });
    expect((boundary('technical-network').size as number[])[2]).toBeLessThanOrEqual(80);
    expect((boundary('violet-filaments').size as number[])[0]).toBeLessThanOrEqual(72);
  });


  it('offers three to five named presets, all of them known swarms', () => {
    expect(FLOCKING_CARD_PRESET_IDS.length).toBeGreaterThanOrEqual(3);
    expect(FLOCKING_CARD_PRESET_IDS.length).toBeLessThanOrEqual(5);
    for (const id of FLOCKING_CARD_PRESET_IDS) expect(getFlockPreset(id)?.label, id).toBeTruthy();
    // Saved projects and tools keep every earlier id.
    for (const id of ['free-swarm', 'krill-cloud', 'vortex', 'follow-path', 'technical-network', 'shrimp-pullback', 'violet-filaments', 'sculpture-terracotta', 'sculpture-lilac']) {
      expect(FLOCK_PRESETS.some(preset => preset.id === id), id).toBe(true);
    }
  });

  it('keeps the card swarms inside the default frame', () => {
    const node = (presetId: string, operator: string) => createFlockPresetDefinition(presetId).nodes.find(item => item.operator === operator)!;
    // Sphere boundaries take their radius from size[0].
    expect((node('free-swarm', 'flock.boundary').params.size as number[])[0]).toBeLessThanOrEqual(80);
    expect((node('violet-filaments', 'flock.boundary').params.size as number[])[0]).toBeLessThanOrEqual(120);
    expect(node('follow-path', 'flock.path').params.radius).toBeLessThanOrEqual(65);
    // Box boundaries span their size: Technical Network used to bounce off walls outside the picture.
    expect((node('technical-network', 'flock.boundary').params.size as number[])[1]).toBeLessThanOrEqual(140);
  });

  it('describes every card preset in plain words', () => {
    for (const id of FLOCKING_CARD_PRESET_IDS) expect(getFlockPreset(id)!.description, id).not.toMatch(/boids|APIC|neighbor/i);
  });
});

describe('flockSliderRange', () => {
  it('uses a declared range of the value scale and a scale of the default otherwise', () => {
    expect(flockSliderRange({}, param('flock.rules', 'cohesion'), 1)).toMatchObject({ min: 0, max: 10, hardMin: 0, hardMax: 10 });
    // Points Size is declared 0–200: the slider covers 0–24 around its default 6, typing reaches 200.
    const size = { ...param('flock.render-points', 'size'), default: 6 };
    expect(flockSliderRange({}, size, 6)).toMatchObject({ min: 0, max: 24, hardMax: 200 });
    // Controls exposed by earlier Add pickers carry a copy of the declared limits: still the short slider.
    expect(flockSliderRange({ min: 0, max: 200 }, size, 6)).toMatchObject({ min: 0, max: 24, hardMax: 200 });
    // Max Speed has no upper limit: the slider spans four times the default, typing is open.
    expect(flockSliderRange({}, param('flock.simulation', 'maxSpeed'), 45)).toMatchObject({ min: 0, max: 180, hardMax: Number.POSITIVE_INFINITY });
  });

  it('starts an open lower limit at 0 for a positive default and always includes the value', () => {
    // A strength without a lower limit (as Attractor and Vortex declare theirs).
    const turbulence = { ...param('flock.turbulence', 'strength'), min: undefined };
    const range = flockSliderRange({}, turbulence, 300);
    expect(range.min).toBe(0);
    expect(range.max).toBe(300);
    expect(range.hardMin).toBe(Number.NEGATIVE_INFINITY);
    expect(flockSliderRange({ min: 1, max: 3 }, turbulence, 2)).toMatchObject({ min: 1, max: 3 });
  });
});

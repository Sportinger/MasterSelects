// Sheen, Rom1 and Voxel Relief name the values their shaders clamp; display units are display-only.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveEffectParamRow } from '../../src/components/panels/properties/ResolveEffectParamRow';
import { getDefaultParams, getEffect } from '../../src/effects';
import { isFullscreenEffectDefinition } from '../../src/effects/types';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { withLegacyLookParams } from '../../src/effects/looks/legacyLookParams';
import { createRom1GraphBefore20261022 } from '../../src/services/operators/rom1EffectGraph';
import { clampSmokeGainGraph, kneeRom1GainGraph, rom1GainLift } from '../../src/services/operators/smokeGainUpgrade';
import { createSavedRom1GraphBeforeGainKnee } from '../fixtures/rom1GraphBeforeGainKnee';
import { createLegacyAcuarelaGraph } from '../../src/services/operators/acuarelaEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

vi.mock('../../src/components/panels/properties/LabeledValue', () => ({
  LabeledValue: ({ value, suffix, ariaLabel }: { value: number; suffix?: string; ariaLabel: string }) =>
    <input aria-label={ariaLabel} data-suffix={suffix} value={String(value)} readOnly />,
}));
afterEach(() => cleanup());

const warnings = (id: string, overrides: Record<string, number | string | boolean>) => {
  const definition = getEffect(id)!;
  return definition.paramWarnings!({ ...getDefaultParams(id), ...overrides } as Record<string, number | string | boolean>, 1920, 1080);
};

describe('stylize clamp notes', () => {
  it('has no notes at the defaults', () => {
    for (const id of ['sheen', 'rom1', 'voxel-relief']) expect(warnings(id, {}), id).toEqual([]);
  });

  it('names Sheen values it turns off or clamps', () => {
    expect(warnings('sheen', { intensity: -1, width: 0, softness: 2 })).toEqual([
      'intensity: -1 is below 0; it renders as 0 (no sheen). Use a darker Color for a dim sweep.',
      'width: 0 has no band; it renders as the thinnest line.', 'softness: 2 is outside 0-1; it is clamped to 1.']);
  });

  it('names Rom1 values that whiten or stop the smoke', () => {
    expect(warnings('rom1', { gain: 3, speed: 0, opacity: 1.5 })).toEqual([
      'gain: 3 is above 1; above 0.25 the lift eases toward 0.5, so the frame washes out but never turns white.', 'opacity: 1.5 is outside 0-1; it is clamped to 1.',
      'speed: 0 is not above 0; it renders as 0.001 and the smoke stops drifting.']);
  });

  it('names Voxel Relief values the raymarcher clamps, and packs non-finite values as defaults', () => {
    expect(warnings('voxel-relief', { columns: 500, distance: 0, maxSteps: 400, heightContrast: 0, height: -1 })).toEqual([
      'columns: 500 is outside 4-240; it renders as 240.', 'distance: 0 is outside 0.15-8; it renders as 0.15.',
      'maxSteps: 400 is outside 24-144; the ray budget is clamped to 144 steps.', 'height: -1 is below 0; it renders as 0.',
      'heightContrast: 0 is not above 0; every block takes the same height.']);
    const voxel = getEffect('voxel-relief')!;
    if (!isFullscreenEffectDefinition(voxel)) throw new Error('Voxel Relief is a fullscreen effect');
    const packed = voxel.packUniforms({ ...getDefaultParams('voxel-relief'), columns: Number.NaN, tilt: 'steep' } as never, 1920, 1080)!;
    expect(packed[0]).toBeCloseTo(107.4, 4);
    expect(packed[4]).toBe(87);
    expect([...packed].every(Number.isFinite)).toBe(true);
    expect(getEffectOperator('camera.orbit')?.parameters.find(parameter => parameter.id === 'tilt')?.unit).toBe('degrees');
  });

  it('packs one pixel in band units for the Sheen hard edge, Highlights and the profile, never NaN', () => {
    const sheen = getEffect('sheen')!;
    if (!isFullscreenEffectDefinition(sheen)) throw new Error('Sheen is a fullscreen effect');
    const packed = sheen.packUniforms(getDefaultParams('sheen') as never, 1920, 1080)!;
    expect(packed[5]).toBeCloseTo(1920 / 1080, 6);
    expect(packed[6]).toBeCloseTo(1 / 1080, 9);
    expect(packed[7]).toBeCloseTo(0.6, 6);
    expect(packed[12]).toBe(0);
    expect(sheen.packUniforms({ ...getDefaultParams('sheen'), profile: 'plateau' } as never, 1920, 1080)![12]).toBe(1);
    const broken = sheen.packUniforms({ ...getDefaultParams('sheen'), position: Number.NaN, angle: 'steep', width: Infinity, intensity: '2' } as never, 1920, 1080)!;
    expect([...broken].every(Number.isFinite)).toBe(true);
    expect([broken[0], broken[1], broken[2], broken[4]]).toEqual([0.5, 25, expect.closeTo(0.18, 6), 2]);
  });

  it('keeps saved Sheen, Voxel Relief and Rom1 effects on their look', () => {
    const effect = (type: string, params: Record<string, unknown>) => ({ id: type, type, name: type, enabled: true, params }) as unknown as Effect;
    const { profile: _profile, highlights: _highlights, ...oldSheen } = getDefaultParams('sheen');
    expect(migratePersistedEffectOperatorGraph(effect('sheen', oldSheen)).params).toMatchObject({ profile: 'plateau', highlights: 0 });
    expect(migratePersistedEffectOperatorGraph(effect('sheen', getDefaultParams('sheen'))).params).toMatchObject({ profile: 'falloff', highlights: 0.6 });
    expect(warnings('sheen', { profile: 'plateau' })[0]).toMatch(/^profile: this effect was saved with the flat-topped band/);
    expect(withLegacyLookParams('sheen', { intensity: 1 })).toEqual({ intensity: 1, profile: 'plateau', highlights: 0 });
    const { shading: _shading, ...oldVoxel } = getDefaultParams('voxel-relief');
    expect(migratePersistedEffectOperatorGraph(effect('voxel-relief', oldVoxel)).params.shading).toBe('legacy');
    expect(migratePersistedEffectOperatorGraph(effect('voxel-relief', getDefaultParams('voxel-relief'))).params.shading).toBe('hue');
    const voxel = getEffect('voxel-relief')!;
    if (!isFullscreenEffectDefinition(voxel)) throw new Error('Voxel Relief is a fullscreen effect');
    expect(voxel.packUniforms({ ...getDefaultParams('voxel-relief'), shading: 'legacy' } as never, 1920, 1080)![27]).toBe(1);
    expect(voxel.packUniforms(getDefaultParams('voxel-relief') as never, 1920, 1080)![27]).toBe(0);
    // The iPad-tuned relief defaults stay; the default camera Distance now fills the layer at Tilt 87.
    expect(getDefaultParams('voxel-relief')).toMatchObject({ height: 1.2, heightContrast: 3, distance: 0.8 });
    // Voxel Relief saved before Distance existed keeps the Distance 1 framing (the default is now 0.8).
    const { distance: _distance, ...noDistance } = getDefaultParams('voxel-relief');
    expect(migratePersistedEffectOperatorGraph(effect('voxel-relief', noDistance)).params.distance).toBe(1);
    expect(migratePersistedEffectOperatorGraph(effect('voxel-relief', { ...noDistance, distance: 0.7 })).params.distance).toBe(0.7);
    expect(withLegacyLookParams('voxel-relief', { height: 1 })).toMatchObject({ distance: 1, shading: 'legacy' });
    // Rom1 graphs saved before the Gain knee (frozen copy of the 16892ba55 recipe) get the knee on load.
    const before = createSavedRom1GraphBeforeGainKnee();
    expect(before.edges.find(edge => edge.to === 'gain-rgb')?.from).toBe('safe-gain');
    const loaded = migratePersistedEffectOperatorGraph({ ...effect('rom1', getDefaultParams('rom1')), operatorGraph: before }).operatorGraph!;
    const resolved = effectOperatorGraph({ ...effect('rom1', getDefaultParams('rom1')), operatorGraph: loaded });
    expect(resolved.edges.find(edge => edge.to === 'gain-rgb')?.from).toBe('gain-knee');
    expect(kneeRom1GainGraph(kneeRom1GainGraph(before))).toBe(kneeRom1GainGraph(before));
    // The knee turns it into the recipe saved before 2026-10-22, which then upgrades to the premultiplied trail.
    expect(createRom1GraphBefore20261022().nodes.map(item => item.id).toSorted()).toEqual(kneeRom1GainGraph(before).nodes.map(item => item.id).toSorted());
    // On a black opaque frame with empty history the Rom1 output is the lift itself. Up to 0.25 it is
    // the old linear lift, so saved looks stay the same; above it eases toward 0.5 and never whitens.
    const lift = (graph: EffectOperatorGraph, gain: number) => evaluateImageOperatorPlan(
      compileImageOperatorGraph(graph, { ...getDefaultParams('rom1'), gain }, { allowFrameHistory: true }), [0, 0, 0, 1],
      { uv: [.5, .5], resolution: [8, 8], timelineTimeSeconds: 0, sampleImage: () => [0, 0, 0, 1], sampleResource: () => [0, 0, 0, 0] })[0];
    for (const gain of [0, 0.01, 0.1, 0.2, 0.25]) {
      expect(lift(before, gain), `saved gain ${gain}`).toBeCloseTo(gain, 6);
      expect(lift(resolved, gain), `gain ${gain}`).toBeCloseTo(gain, 6);
    }
    for (const gain of [0.3, 0.5, 1, 3, 100]) {
      expect(lift(resolved, gain), `gain ${gain}`).toBeCloseTo(0.25 + 0.25 * (1 - Math.exp(-(gain - 0.25) / 0.25)), 6);
      expect(lift(resolved, gain)).toBeLessThanOrEqual(0.5);
      expect(rom1GainLift(gain)).toBeCloseTo(lift(resolved, gain), 6);
    }
    expect(lift(resolved, 1)).toBeLessThan(lift(before, 1));
    // Smoke Acuarela graphs saved with max(gain, 0) get the 0..1 clamp.
    const acuarelaSmoke = createLegacyAcuarelaGraph(), clampNode = acuarelaSmoke.nodes.find(item => item.id === 'safe-gain')!;
    expect(clampNode.operator).toBe('math.clamp.scalar');
    const savedSmoke: EffectOperatorGraph = { ...acuarelaSmoke, nodes: acuarelaSmoke.nodes.map(item => item.id === 'safe-gain' ? { ...item, operator: 'math.max.scalar' } : item),
      edges: acuarelaSmoke.edges.filter(item => !(item.to === 'safe-gain' && item.input === 'max'))
        .map(item => item.to === 'safe-gain' ? { ...item, input: item.input === 'value' ? 'a' : 'b' } : item) };
    const clampedSmoke = clampSmokeGainGraph(savedSmoke);
    expect(clampedSmoke.nodes.find(item => item.id === 'safe-gain')!.operator).toBe('math.clamp.scalar');
    expect(clampedSmoke.edges.filter(item => item.to === 'safe-gain').map(item => `${item.from}>${item.input}`).toSorted()).toEqual(['gain>value', 'one>max', 'zero>min']);
  });

  it('shows a display-only unit after the value without changing it', () => {
    const definition = getEffect('sheen')!.params.angle;
    render(<ResolveEffectParamRow paramName="angle" definition={definition} value={25} effect={{ id: 'sheen-1', params: { angle: 25 } }} onChange={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Angle' }) as HTMLInputElement;
    expect(field.value).toBe('25');
    expect(field.dataset.suffix).toBe('°');
  });
});

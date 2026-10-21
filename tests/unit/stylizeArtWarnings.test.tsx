// Sheen, Rom1 and Voxel Relief name the values their shaders clamp; display units are display-only.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveEffectParamRow } from '../../src/components/panels/properties/ResolveEffectParamRow';
import { getDefaultParams, getEffect } from '../../src/effects';
import { isFullscreenEffectDefinition } from '../../src/effects/types';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { withLegacyLookParams } from '../../src/effects/looks/legacyLookParams';
import { createDefaultRom1Graph } from '../../src/services/operators/rom1EffectGraph';
import { clampSmokeGainGraph, shoulderRom1GainGraph } from '../../src/services/operators/smokeGainUpgrade';
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
      'gain: 3 is above 1; the lift eases toward 0.35, so the frame washes out but never turns white.', 'opacity: 1.5 is outside 0-1; it is clamped to 1.',
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
    expect(getDefaultParams('voxel-relief')).toMatchObject({ height: 1.2, heightContrast: 3, distance: 0.85 });
    // Rom1 graphs saved with Gain = max(gain, 0) feeding the lift get the soft shoulder on load.
    const rom1 = createDefaultRom1Graph();
    expect(rom1.edges.find(edge => edge.to === 'gain-rgb')?.from).toBe('gain-shoulder');
    const shoulderIds = new Set(rom1.nodes.filter(item => item.id.startsWith('gain-shoulder')).map(item => item.id));
    const saved: EffectOperatorGraph = { ...rom1, nodes: rom1.nodes.filter(item => !shoulderIds.has(item.id)),
      edges: [...rom1.edges.filter(item => !shoulderIds.has(item.from) && !shoulderIds.has(item.to)),
        { id: 'safe-gain-value-gain-rgb-value', from: 'safe-gain', output: 'value', to: 'gain-rgb', input: 'value' }] };
    const upgraded = shoulderRom1GainGraph(saved);
    expect(upgraded.nodes.map(item => item.id).toSorted()).toEqual(rom1.nodes.map(item => item.id).toSorted());
    expect(upgraded.edges.find(edge => edge.to === 'gain-rgb')?.from).toBe('gain-shoulder');
    expect(shoulderRom1GainGraph(upgraded)).toBe(upgraded);
    // On a black opaque frame with empty history, the Rom1 output is the lift itself: 0.35 (1 - exp(-g / 0.35)).
    for (const gain of [0.01, 0.3, 1, 3, 100]) {
      const plan = compileImageOperatorGraph(rom1, { ...getDefaultParams('rom1'), gain }, { allowFrameHistory: true });
      const pixel = evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [.5, .5], resolution: [8, 8], timelineTimeSeconds: 0,
        sampleImage: () => [0, 0, 0, 1], sampleResource: () => [0, 0, 0, 0] });
      expect(pixel[0], `gain ${gain}`).toBeCloseTo(0.35 * (1 - Math.exp(-gain / 0.35)), 6);
      expect(pixel[0]).toBeLessThan(0.351);
    }
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

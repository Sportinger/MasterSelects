// Sheen, Rom1 and Voxel Relief name the values their shaders clamp; display units are display-only.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveEffectParamRow } from '../../src/components/panels/properties/ResolveEffectParamRow';
import { getDefaultParams, getEffect } from '../../src/effects';
import { isFullscreenEffectDefinition } from '../../src/effects/types';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';

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
      'gain: 3 lifts every pixel past white; the trails fill the frame with white.', 'opacity: 1.5 is outside 0-1; it is clamped to 1.',
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

  it('packs one pixel in band units for the Sheen hard edge', () => {
    const sheen = getEffect('sheen')!;
    if (!isFullscreenEffectDefinition(sheen)) throw new Error('Sheen is a fullscreen effect');
    const packed = sheen.packUniforms(getDefaultParams('sheen') as never, 1920, 1080)!;
    expect(packed[5]).toBeCloseTo(1920 / 1080, 6);
    expect(packed[6]).toBeCloseTo(1 / 1080, 9);
  });

  it('shows a display-only unit after the value without changing it', () => {
    const definition = getEffect('sheen')!.params.angle;
    render(<ResolveEffectParamRow paramName="angle" definition={definition} value={25} effect={{ id: 'sheen-1', params: { angle: 25 } }} onChange={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Angle' }) as HTMLInputElement;
    expect(field.value).toBe('25');
    expect(field.dataset.suffix).toBe('°');
  });
});

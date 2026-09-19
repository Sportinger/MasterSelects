import { describe, expect, it } from 'vitest';

import { getDefaultParams, getEffect } from '../../src/effects';
import { isComputeEffectDefinition } from '../../src/effects/types';

describe('Analog Signal Lab effect', () => {
  it('registers the dedicated multi-pass analog compute mode', () => {
    const effect = getEffect('analog-signal-lab');

    expect(effect).toBeDefined();
    expect(isComputeEffectDefinition(effect)).toBe(true);
    if (!isComputeEffectDefinition(effect)) return;

    expect(effect.computeMode).toBe('analog-signal');
    expect(effect.entryPoint).toBe('analogResolveCompute');
    expect(effect.uniformSize).toBe(160);
    expect(effect.requiresContinuousRender).toBe(false);
  });

  it('packs timeline time and the physical module controls deterministically', () => {
    const effect = getEffect('analog-signal-lab');
    expect(isComputeEffectDefinition(effect)).toBe(true);
    if (!isComputeEffectDefinition(effect)) return;

    const defaults = getDefaultParams(effect.id);
    const first = effect.packUniforms(defaults, 1920, 1080, 12.5);
    const second = effect.packUniforms(defaults, 1920, 1080, 12.5);
    expect(first).toEqual(second);
    expect(first).toBeInstanceOf(Float32Array);
    if (!(first instanceof Float32Array)) return;

    expect(first).toHaveLength(40);
    expect(first[0]).toBe(1920);
    expect(first[1]).toBe(1080);
    expect(first[2]).toBe(12.5);
    expect(first[5]).toBeCloseTo(0.82);
    expect(first[9]).toBeCloseTo(1.8);
    expect(first[16]).toBe(0);
    expect(first[24]).toBeCloseTo(0.25);
    expect(first[30]).toBe(1);
    expect(first[32]).toBe(1);
    expect(first[33]).toBeCloseTo(0.72);
    expect(first[34]).toBeCloseTo(0.38);
    expect(first[38]).toBe(1);
    expect(first[39]).toBe(1);
  });

  it('encodes VHS speed and PAL decoder selections as stable variants', () => {
    const effect = getEffect('analog-signal-lab');
    expect(isComputeEffectDefinition(effect)).toBe(true);
    if (!isComputeEffectDefinition(effect)) return;

    const packed = effect.packUniforms({
      ...getDefaultParams(effect.id),
      tapeSpeed: 'ep',
      decoder: 'comb',
    }, 1280, 720, 3);
    expect(packed).toBeInstanceOf(Float32Array);
    if (!(packed instanceof Float32Array)) return;

    expect(packed[23]).toBe(2);
    expect(packed[30]).toBe(2);
  });

  it('exposes independent stage masters and PAL encoding controls', () => {
    const effect = getEffect('analog-signal-lab');
    expect(isComputeEffectDefinition(effect)).toBe(true);
    if (!isComputeEffectDefinition(effect)) return;

    expect(effect.params.palAmount?.default).toBe(1);
    expect(effect.params.rfAmount?.default).toBe(1);
    expect(effect.params.receiverAmount?.default).toBe(1);
    expect(effect.params.vhsAmount?.default).toBe(0);
    expect(effect.params.crtAmount?.default).toBeCloseTo(0.25);
    expect(effect.params.lumaBandwidth).toBeDefined();
    expect(effect.params.chromaBandwidth).toBeDefined();
    expect(effect.params.chromaLevel).toBeDefined();
    expect(effect.params.ycCrosstalk).toBeDefined();
    expect(effect.params.palPhaseError).toBeDefined();
  });
});

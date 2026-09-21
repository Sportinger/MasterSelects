import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';

const bindings = { rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' };

describe('glyph owner compile context', () => {
  it('uses the existing effect atlas resolver and catalog defaults', () => {
    const definition = getEffect('ascii')!;
    if (!('glyphAtlas' in definition) || !definition.glyphAtlas) throw new Error('ASCII atlas missing');
    const defaults = Object.fromEntries(Object.entries(definition.params).map(([key, spec]) => [key, spec.default]));
    const context = effectOperatorCompileContext({ type: 'ascii' });
    expect(context.resolveGlyphAtlas!(bindings, {})).toEqual(definition.glyphAtlas(defaults));
    expect(context.resolveGlyphAtlas!(bindings, { customRamp: 'A🙂Z', fontWeight: 800 }))
      .toEqual(definition.glyphAtlas({ ...defaults, customRamp: 'A🙂Z', fontWeight: 800 }));
  });

  it('rejects incompatible owner bindings and does not invent a resolver for other effects', () => {
    const resolve = effectOperatorCompileContext({ type: 'ascii' }).resolveGlyphAtlas!;
    expect(() => resolve({ ...bindings, customRamp: 'amount' }, {})).toThrow(/compatible owner parameter/);
    expect(() => resolve(bindings, { fontWeight: NaN })).toThrow(/invalid value/);
    expect(effectOperatorCompileContext({ type: 'invert' }).resolveGlyphAtlas).toBeUndefined();
  });
});

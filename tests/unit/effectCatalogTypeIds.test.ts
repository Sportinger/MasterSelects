import { describe, expect, it } from 'vitest';
import { resolveEffectTypeId } from '../../src/effects';
import { compileEffectEdit } from '../../src/services/guidedActions/choreography/propertyEditChoreographies';

describe('node-catalog effect IDs', () => {
  it('resolves only known effect: prefixed IDs to registry IDs', () => {
    expect(resolveEffectTypeId('effect:pixel-particle-disintegrate')).toBe('pixel-particle-disintegrate');
    expect(resolveEffectTypeId('gaussian-blur')).toBe('gaussian-blur');
    expect(resolveEffectTypeId('effect:not-an-effect')).toBe('effect:not-an-effect');
  });

  it('validates a guided addEffect against the registry ID', () => {
    const actions = compileEffectEdit(
      { id: 'call-1', tool: 'addEffect', args: { clipId: 'clip-a', effectType: 'effect:pixel-particle-disintegrate' } },
      { includeValidation: true } as Parameters<typeof compileEffectEdit>[1],
    );
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: { kind: 'effectExists', clipId: 'clip-a', effectType: 'pixel-particle-disintegrate' },
    }));
  });
});

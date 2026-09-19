import { describe, expect, it } from 'vitest';

import {
  getSeedanceReferenceValidationError,
  isSeedance2ProviderId,
  isSeedanceProviderId,
} from '../../src/services/flashboard/seedanceReferenceRules';

describe('Seedance reference rules', () => {
  it('detects Seedance 2 provider ids', () => {
    expect(isSeedance2ProviderId('bytedance/seedance-2')).toBe(true);
    expect(isSeedance2ProviderId('bytedance/seedance-2-fast')).toBe(true);
    expect(isSeedance2ProviderId('kling-3.0')).toBe(false);
    expect(isSeedanceProviderId('bytedance/seedance-2-5')).toBe(true);
  });

  it('blocks all Seedance multimodal references before Kie.ai submission', () => {
    expect(getSeedanceReferenceValidationError({
      hasReferenceMedia: true,
      providerId: 'bytedance/seedance-2',
    })).toContain('multimodal references are temporarily disabled');
  });

  it('allows Seedance exact-frame mode without extra references', () => {
    expect(getSeedanceReferenceValidationError({
      hasReferenceMedia: false,
      providerId: 'bytedance/seedance-2-fast',
    })).toBeNull();
  });

  it('allows Seedance 2.5 multimodal references within documented limits', () => {
    expect(getSeedanceReferenceValidationError({
      audioReferenceCount: 2,
      audioReferenceDuration: 18,
      hasReferenceMedia: true,
      imageReferenceCount: 12,
      providerId: 'bytedance/seedance-2-5',
      videoReferenceCount: 3,
      videoReferenceDuration: 29,
    })).toBeNull();
  });

  it('keeps Seedance 2.5 exact-frame and multimodal modes exclusive', () => {
    expect(getSeedanceReferenceValidationError({
      hasExactFrames: true,
      hasReferenceMedia: true,
      providerId: 'bytedance/seedance-2-5',
    })).toContain('separate modes');
  });

  it('enforces Seedance 2.5 reference count and duration limits', () => {
    expect(getSeedanceReferenceValidationError({
      hasReferenceMedia: true,
      providerId: 'bytedance/seedance-2-5',
      videoReferenceCount: 11,
    })).toContain('at most 10 reference videos');

    expect(getSeedanceReferenceValidationError({
      audioReferenceDuration: 31,
      hasReferenceMedia: true,
      providerId: 'bytedance/seedance-2-5',
    })).toContain('at most 30 seconds');
  });

  it('does not apply Seedance reference rules to other providers', () => {
    expect(getSeedanceReferenceValidationError({
      hasReferenceMedia: true,
      providerId: 'kling-3.0',
    })).toBeNull();
  });
});

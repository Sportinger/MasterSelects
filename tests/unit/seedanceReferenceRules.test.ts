import { describe, expect, it } from 'vitest';

import {
  getSeedanceReferenceValidationError,
  isSeedance2ProviderId,
} from '../../src/services/flashboard/seedanceReferenceRules';

describe('Seedance reference rules', () => {
  it('detects Seedance 2 provider ids', () => {
    expect(isSeedance2ProviderId('bytedance/seedance-2')).toBe(true);
    expect(isSeedance2ProviderId('bytedance/seedance-2-fast')).toBe(true);
    expect(isSeedance2ProviderId('kling-3.0')).toBe(false);
  });

  it('blocks audio-only Seedance references before Kie.ai submission', () => {
    expect(getSeedanceReferenceValidationError({
      hasAudioReference: true,
      hasVisualReference: false,
      providerId: 'bytedance/seedance-2',
    })).toBe('Seedance audio references need at least one image or video reference.');
  });

  it('allows Seedance audio references with a visual anchor', () => {
    expect(getSeedanceReferenceValidationError({
      hasAudioReference: true,
      hasVisualReference: true,
      providerId: 'bytedance/seedance-2-fast',
    })).toBeNull();
  });
});

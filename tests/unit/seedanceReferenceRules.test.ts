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

  it('does not apply Seedance reference rules to other providers', () => {
    expect(getSeedanceReferenceValidationError({
      hasReferenceMedia: true,
      providerId: 'kling-3.0',
    })).toBeNull();
  });
});

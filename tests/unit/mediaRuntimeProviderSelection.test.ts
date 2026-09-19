import { describe, expect, it } from 'vitest';

import { selectRuntimeFrameProviderPlan } from '../../src/services/mediaRuntime/providerSelection';

describe('media runtime provider selection', () => {
  it('selects TurboRes only for an enabled classic ProRes FourCC', () => {
    expect(selectRuntimeFrameProviderPlan({
      videoCodecId: 'apch',
      turboResEnabled: true,
    })).toEqual({ backend: 'turbores', fourCC: 'apch' });
  });

  it('preserves the existing path while the flag is disabled', () => {
    expect(selectRuntimeFrameProviderPlan({
      videoCodecId: 'apch',
      turboResEnabled: false,
    })).toEqual({ backend: 'default', reason: 'turbores-disabled' });
    expect(selectRuntimeFrameProviderPlan({
      videoCodecId: 'avc1',
      turboResEnabled: true,
    })).toEqual({ backend: 'default', reason: 'not-prores' });
  });

  it('does not route ProRes RAW into the classic decoder', () => {
    expect(selectRuntimeFrameProviderPlan({
      videoCodecId: 'aprh',
      turboResEnabled: true,
    })).toEqual({ backend: 'unsupported', reason: 'prores-raw' });
  });
});

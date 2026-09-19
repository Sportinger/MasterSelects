import { describe, expect, it } from 'vitest';

import { getNestedVideoLayerSourceKey } from '../../src/services/layerBuilder/layerBuilderNestedVideoSource';

describe('nested Datamosh preview source identity', () => {
  it('marks only baked Datamosh transition clips for stable canvas staging', () => {
    expect(getNestedVideoLayerSourceKey(
      'track-key',
      'continuity-key',
      'transition-comp:transition-1:datamosh',
    )).toMatch(/^nested-video:[a-z0-9]+:datamosh$/);

    expect(getNestedVideoLayerSourceKey(
      'track-key',
      'continuity-key',
      'transition-comp:transition-1:incoming',
    )).toMatch(/^nested-video:[a-z0-9]+$/);
  });
});

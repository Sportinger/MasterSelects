import { describe, expect, it } from 'vitest';

import type { Layer } from '../../src/engine/core/types';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import { TargetPreviewLayerCollector } from '../../src/engine/render/dispatcher/targetPreviewLayerCollector';

describe('TargetPreviewLayerCollector', () => {
  it('keeps native 3D sources for the shared scene pass', () => {
    const collector = new TargetPreviewLayerCollector({} as RenderDeps);
    const layer = {
      id: 'model-layer',
      visible: true,
      opacity: 1,
      is3D: true,
      source: { type: 'model' },
    } as Layer;

    expect(collector.collect([layer])).toEqual([{
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: 0,
      sourceHeight: 0,
    }]);
  });
});

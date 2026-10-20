import { describe, expect, it } from 'vitest';

import {
  WORKER_PRESENTER_PLUS_BLEND_INDEX,
  resolveWorkerPresenterBlendIndex,
} from '../../src/services/render/workerGpuPresenterBlendModes';
import { VIDEO_FRAME_LAYER_COMPOSITE_SHADER } from '../../src/services/render/workerGpuVideoFrameLayerShaderSource';
import { Logger } from '../../src/services/logger';

describe('Worker video presenter blend modes', () => {
  it('adds plus layers instead of drawing them Normal, and logs modes it does not implement', () => {
    Logger.clear();
    expect(resolveWorkerPresenterBlendIndex('plus')).toBe(WORKER_PRESENTER_PLUS_BLEND_INDEX);
    expect(resolveWorkerPresenterBlendIndex('screen')).toBe(2);
    expect(Logger.search('does not implement this blend mode')).toHaveLength(0);

    expect(resolveWorkerPresenterBlendIndex('hue')).toBe(0);
    resolveWorkerPresenterBlendIndex('hue');
    expect(Logger.search('does not implement this blend mode').map((entry) => entry.data)).toEqual([{ blendMode: 'hue' }]);

    expect(VIDEO_FRAME_LAYER_COMPOSITE_SHADER).toContain(`if (layer.blendMode == ${WORKER_PRESENTER_PLUS_BLEND_INDEX}u) {`);
  });
});

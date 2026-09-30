import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: {} }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: {} }));
vi.mock('../../src/stores/settingsStore', () => ({ useSettingsStore: {} }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: {} }));

import { resolvePreviewRenderQuality } from '../../src/hooks/engine/useEngineResolutionSync';

describe('explicit full preview quality', () => {
  it.each([[3840, 2160], [4096, 2160], [2160, 3840]])(
    'preserves Full at %sx%s during playback and scrubbing', (width, height) => {
      expect(resolvePreviewRenderQuality(width, height, 1, true)).toBe(1);
      expect(resolvePreviewRenderQuality(width, height, 1, false)).toBe(1);
    },
  );

  it('retains the selected lower quality for ordinary 4K playback', () => {
    expect(resolvePreviewRenderQuality(3840, 2160, 0.5, true)).toBe(0.5);
    expect(resolvePreviewRenderQuality(3840, 2160, 0.25, true)).toBe(0.25);
  });
});

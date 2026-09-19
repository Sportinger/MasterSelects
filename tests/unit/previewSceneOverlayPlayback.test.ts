import { describe, expect, it } from 'vitest';

import { shouldShowSceneObjectOverlay } from '../../src/components/preview/usePreviewModeState';

describe('preview scene overlay playback visibility', () => {
  it('keeps scene overlays visible during playback in Edit mode', () => {
    expect(shouldShowSceneObjectOverlay(true, true, true, true, true)).toBe(true);
  });

  it('keeps regular playback clean outside Edit mode', () => {
    expect(shouldShowSceneObjectOverlay(true, true, true, true, false)).toBe(false);
  });

  it('respects the scene overlay icon toggle during Edit playback', () => {
    expect(shouldShowSceneObjectOverlay(false, true, true, true, true)).toBe(false);
  });

  it('continues to show enabled scene overlays while paused', () => {
    expect(shouldShowSceneObjectOverlay(true, true, true, false, false)).toBe(true);
  });
});

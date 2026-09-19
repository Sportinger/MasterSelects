import { describe, expect, it } from 'vitest';

import {
  isAndroidVideoFrameRuntime,
  shouldCopyHtmlVideoPreviewFrame,
} from '../../src/engine/texture/videoFrameCopyPolicy';

describe('isAndroidVideoFrameRuntime', () => {
  it('detects Android from the user agent and client-hint platform', () => {
    expect(isAndroidVideoFrameRuntime({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) Mobile',
    })).toBe(true);
    expect(isAndroidVideoFrameRuntime({
      userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
      userAgentData: { platform: 'Android' },
    })).toBe(true);
  });

  it('leaves desktop and iPad video frames on the direct path', () => {
    expect(isAndroidVideoFrameRuntime({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })).toBe(false);
    expect(isAndroidVideoFrameRuntime({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X)',
    })).toBe(false);
  });

  it('uses copied preview textures throughout Android playback', () => {
    expect(shouldCopyHtmlVideoPreviewFrame({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) Chrome/140 Mobile',
    })).toBe(true);
    expect(shouldCopyHtmlVideoPreviewFrame({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })).toBe(false);
  });
});

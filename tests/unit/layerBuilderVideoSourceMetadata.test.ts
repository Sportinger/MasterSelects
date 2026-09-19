import { afterEach, describe, expect, it } from 'vitest';
import { linkedMediaSourceRuntime } from '../../src/services/mediaRuntime/linkedMediaSourceRuntime';
import { getLayerSourceMetadata } from '../../src/services/layerBuilder/layerBuilderVideoSourceMetadata';
import type { TimelineClip } from '../../src/types/timeline';

const clip = {
  id: 'clip-1',
  mediaFileId: 'media-1',
  source: { type: 'video', mediaFileId: 'media-1' },
} as TimelineClip;

describe('layer builder video source metadata', () => {
  afterEach(() => linkedMediaSourceRuntime.clear());

  it('uses composition geometry for a Premiere proxy when original dimensions are unavailable', () => {
    linkedMediaSourceRuntime.setActive('media-1', {
      kind: 'linked',
      sourceId: 'premiere-proxy',
    });

    const result = getLayerSourceMetadata(
      clip,
      {
        id: 'media-1',
        linkedSources: [{
          id: 'premiere-proxy',
          role: 'proxy',
          origin: 'premiere',
        }],
      },
      { width: 2048, height: 1080 },
      { width: 3996, height: 2160 },
    );

    expect(result).toMatchObject({
      mediaFileId: 'media-1',
      intrinsicWidth: 3996,
      intrinsicHeight: 2160,
    });
  });

  it('keeps known original dimensions ahead of the proxy fallback', () => {
    linkedMediaSourceRuntime.setActive('media-1', {
      kind: 'linked',
      sourceId: 'premiere-proxy',
    });

    const result = getLayerSourceMetadata(
      clip,
      {
        id: 'media-1',
        width: 6144,
        height: 3456,
        linkedSources: [{
          id: 'premiere-proxy',
          role: 'proxy',
          origin: 'premiere',
        }],
      },
      { width: 2048, height: 1080 },
      { width: 3996, height: 2160 },
    );

    expect(result.intrinsicWidth).toBe(6144);
    expect(result.intrinsicHeight).toBe(3456);
  });

  it('uses the current oriented stream dimensions for a live input', () => {
    const liveClip = {
      ...clip,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        liveInputId: 'live-1',
      },
    } as TimelineClip;

    const result = getLayerSourceMetadata(
      liveClip,
      { id: 'media-1', width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1920, height: 1080 },
    );

    expect(result.intrinsicWidth).toBe(1080);
    expect(result.intrinsicHeight).toBe(1920);
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { MediaFile } from '../../src/stores/mediaStore';
import {
  ensureSeedanceSourceVisualFrames,
  type SeedanceVisualFrameStatus,
} from '../../src/services/seedancePreproduction/sourceVisualFramePreflight';

const sourceBundle = {
  schemaVersion: 1 as const,
  id: `source-bundle-${'a'.repeat(64)}`,
  fingerprint: 'a'.repeat(64),
  createdAt: 1,
  entryCount: 3,
};

function status(complete: boolean): SeedanceVisualFrameStatus {
  return {
    schemaVersion: 1,
    kind: 'source-frame-status',
    sourceBundleId: sourceBundle.id,
    complete,
    media: [{
      sourceMediaId: 'video-1',
      expectedFrameCount: 10,
      storedFrameCount: complete ? 10 : 0,
      expectedContactSheetCount: 1,
      storedContactSheetCount: complete ? 1 : 0,
      complete,
    }],
  };
}

const video = {
  id: 'video-1',
  name: 'real-footage.mp4',
  type: 'video',
  duration: 10,
} as MediaFile;

describe('Seedance visual-frame preflight', () => {
  it('does not decode videos when the durable kernel coverage is already complete', async () => {
    const captureAndUpload = vi.fn();
    await expect(ensureSeedanceSourceVisualFrames(sourceBundle, undefined, {
      captureAndUpload,
      readFiles: () => [video],
      status: async () => status(true),
    })).resolves.toMatchObject({ complete: true });
    expect(captureAndUpload).not.toHaveBeenCalled();
  });

  it('uploads every incomplete video before returning', async () => {
    const captureAndUpload = vi.fn().mockResolvedValue(undefined);
    const readStatus = vi.fn()
      .mockResolvedValueOnce(status(false))
      .mockResolvedValueOnce(status(true));
    await expect(ensureSeedanceSourceVisualFrames(sourceBundle, undefined, {
      captureAndUpload,
      readFiles: () => [video],
      status: readStatus,
    })).resolves.toMatchObject({ complete: true });
    expect(captureAndUpload).toHaveBeenCalledWith(video, sourceBundle.id, undefined);
  });

  it('fails closed when an expected original video is unavailable', async () => {
    await expect(ensureSeedanceSourceVisualFrames(sourceBundle, undefined, {
      captureAndUpload: vi.fn(),
      readFiles: () => [],
      status: async () => status(false),
    })).rejects.toThrow(/original video source is unavailable/i);
  });
});

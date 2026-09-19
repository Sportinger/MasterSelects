import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MediaFile } from '../../src/stores/mediaStore';

const mocks = vi.hoisted(() => ({
  files: [] as MediaFile[],
  runKernelStage: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({ files: mocks.files }),
  },
}));

vi.mock('../../src/services/seedancePreproduction/sourceTranscriptPreflight', () => ({
  ensureSeedanceSourceTranscripts: vi.fn(async () => {
    mocks.files = mocks.files.map((file) => file.id === 'video-1'
      ? {
          ...file,
          transcriptStatus: 'ready' as const,
          transcript: [{ id: 'word-1', text: 'Fresh', start: 0, end: 0.5 }],
        }
      : file);
  }),
}));

vi.mock('../../src/services/seedancePreproduction/sourceVisualFramePreflight', () => ({
  ensureSeedanceSourceVisualFrames: vi.fn(async () => ({
    schemaVersion: 1,
    kind: 'source-frame-status',
    sourceBundleId: 'source-bundle-test',
    complete: true,
    media: [],
  })),
}));

vi.mock('../../src/services/seedancePreproduction/kernelClient', () => ({
  runSeedanceKernelStage: mocks.runKernelStage,
}));

import { seedancePreproductionControllerInternals } from '../../src/marketing/useSeedancePreproductionController';
import { useSeedancePreproductionStore } from '../../src/stores/seedancePreproductionStore';

describe('Seedance selected source bundle', () => {
  beforeEach(() => {
    useSeedancePreproductionStore.getState().reset();
    mocks.files = [{
        id: 'video-1',
        name: 'Interview.mp4',
        type: 'video',
        duration: 2,
        transcriptStatus: 'none',
      } as MediaFile];
    mocks.runKernelStage.mockReset().mockImplementation(async (request) => ({
      schemaVersion: 1,
      kind: 'source-bundle',
      id: `source-bundle-${request.input.fingerprint}`,
      fingerprint: request.input.fingerprint,
      createdAt: 1,
      entryCount: request.input.entries.length,
    }));
  });

  it('re-reads selected media after transcript preparation before ingesting', async () => {
    expect(mocks.files.map((file) => file.id)).toEqual(['video-1']);
    await seedancePreproductionControllerInternals.ensureSourceBundle(['video-1']);

    const request = mocks.runKernelStage.mock.calls[0]?.[0];
    expect(request.operation).toBe('ingest-sources');
    expect(request.input.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'transcript',
        sourceMediaId: 'video-1',
        content: expect.stringContaining('Fresh'),
      }),
    ]));
  });
});

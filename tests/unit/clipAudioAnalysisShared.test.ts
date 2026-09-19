import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isUnreadableClipSourceError,
  resolveClipSourceFile,
} from '../../src/stores/timeline/clip/clipAudioAnalysisShared';
import type { TimelineClip } from '../../src/types/timeline';

const mediaState = vi.hoisted(() => ({ files: [] as Array<{ id: string; file: File }> }));
vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => mediaState },
}));

describe('clip audio analysis source access', () => {
  afterEach(() => {
    mediaState.files = [];
    vi.restoreAllMocks();
  });

  it('rejects empty placeholder files before decoding', async () => {
    const file = new File([], 'placeholder.mp4');
    const read = vi.spyOn(file, 'slice');
    await expect(resolveClipSourceFile({ file } as TimelineClip)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('falls back from an empty clip placeholder to the real media source', async () => {
    const file = new File(['audio'], 'source.wav');
    vi.spyOn(file, 'slice').mockReturnValue({
      arrayBuffer: async () => new ArrayBuffer(1),
    } as Blob);
    mediaState.files = [{ id: 'media-a', file }];
    await expect(resolveClipSourceFile({
      file: new File([], 'placeholder.mp4'),
      source: { mediaFileId: 'media-a' },
    } as TimelineClip)).resolves.toBe(file);
  });

  it('rejects a stale File object that can no longer be read', async () => {
    const file = new File(['audio'], 'offline.wav', { type: 'audio/wav' });
    vi.spyOn(file, 'slice').mockReturnValue({
      arrayBuffer: () => Promise.reject(new DOMException('File is offline', 'NotReadableError')),
    } as Blob);

    await expect(resolveClipSourceFile({ file } as TimelineClip)).resolves.toBeUndefined();
  });

  it('recognizes browser unreadable-file failures', () => {
    expect(isUnreadableClipSourceError(
      new DOMException('File is offline', 'NotReadableError'),
    )).toBe(true);
    expect(isUnreadableClipSourceError(new Error('decode failed'))).toBe(false);
  });
});

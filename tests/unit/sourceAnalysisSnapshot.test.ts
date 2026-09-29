import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types/timeline';
import { collectSourceAnalysisSnapshots, sourceAnalysisSnapshotsMatch } from '../../src/services/agentTimeline/runtime/persistence/sourceAnalysisSnapshot';

describe('source analysis persistence inputs', () => {
  const file = new File(['source'], 'audio.wav');
  const media = { id: 'media', file, duration: 10 } as MediaFile;
  const clip = {
    id: 'clip', mediaFileId: 'media', file, inPoint: 0, outPoint: 10,
    audioState: { sourceAnalysisRefs: { waveformPyramidId: 'waveform-a' } },
  } as TimelineClip;
  const snapshot = (files = [media], clips = [clip]) => collectSourceAnalysisSnapshots(files, clips).get('media')!;

  it('ignores trim, transform, selection-related copies and splitting a source', () => {
    const previous = snapshot();
    const next = snapshot([{ ...media, proxyProgress: 50 }], [
      { ...clip, startTime: 20, outPoint: 5, audioState: { ...clip.audioState } },
      { ...clip, id: 'split', startTime: 25, inPoint: 5 },
    ]);
    expect(sourceAnalysisSnapshotsMatch(previous, next)).toBe(true);
  });

  it('detects completed analysis and audio artifact replacement', () => {
    const previous = snapshot();
    expect(sourceAnalysisSnapshotsMatch(previous, snapshot([media], [{
      ...clip, audioState: { sourceAnalysisRefs: { waveformPyramidId: 'waveform-b' } },
    }]))).toBe(false);
    expect(sourceAnalysisSnapshotsMatch(previous, snapshot([{
      ...media, transcriptStatus: 'ready', transcript: [],
    }]))).toBe(false);
  });

  it('detects source replacement and duration changes, and skips unavailable sources', () => {
    const previous = snapshot();
    expect(sourceAnalysisSnapshotsMatch(previous, snapshot([{ ...media, file: new File(['other'], 'audio.wav') }]))).toBe(false);
    expect(sourceAnalysisSnapshotsMatch(previous, snapshot([{ ...media, duration: 12 }]))).toBe(false);
    expect(collectSourceAnalysisSnapshots([{ ...media, file: undefined }], [{ ...clip, file: undefined, needsReload: true }]).size).toBe(0);
  });
});

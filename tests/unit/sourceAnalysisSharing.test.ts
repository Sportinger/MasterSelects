import { describe, expect, it } from 'vitest';
import {
  applySharedClipAnalysisState,
  clipsShareAnalysisSource,
  getClipAnalysisSourceId,
} from '../../src/services/clipAnalysis/sourceAnalysisSharing';
import type { ClipAnalysis } from '../../src/types/clipMetadata';
import { createMockClip } from '../helpers/mockData';

function analysisAt(timestamp: number): ClipAnalysis {
  return {
    frames: [{
      timestamp,
      motion: 0.2,
      globalMotion: 0.1,
      localMotion: 0.3,
      focus: 0.8,
      brightness: 0.5,
      faceCount: 0,
    }],
    sampleInterval: 500,
  };
}

describe('source analysis sharing', () => {
  it('uses the video media id as the canonical analysis source', () => {
    const source = createMockClip({
      id: 'source',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1' },
    });
    const trimmedCopy = createMockClip({
      id: 'trimmed-copy',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1' },
      inPoint: 2,
      outPoint: 4,
    });
    const linkedAudio = createMockClip({
      id: 'audio',
      mediaFileId: 'media-1',
      source: { type: 'audio', mediaFileId: 'media-1' },
    });

    expect(getClipAnalysisSourceId(source)).toBe('media-1');
    expect(clipsShareAnalysisSource(source, trimmedCopy)).toBe(true);
    expect(getClipAnalysisSourceId(linkedAudio)).toBeNull();
  });

  it('publishes one immutable analysis object to every derived video clip', () => {
    const previous = analysisAt(0);
    const next = analysisAt(2);
    const source = createMockClip({
      id: 'source',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1' },
      analysis: previous,
    });
    const derived = createMockClip({
      id: 'derived',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1' },
      analysis: previous,
    });
    const unrelated = createMockClip({
      id: 'unrelated',
      mediaFileId: 'media-2',
      source: { type: 'video', mediaFileId: 'media-2' },
      analysis: previous,
    });

    const updated = applySharedClipAnalysisState(
      [source, derived, unrelated],
      source.id,
      clip => ({ ...clip, analysis: next, analysisStatus: 'ready' }),
    );

    expect(updated[0].analysis).toBe(next);
    expect(updated[1].analysis).toBe(next);
    expect(updated[2].analysis).toBe(previous);
  });
});

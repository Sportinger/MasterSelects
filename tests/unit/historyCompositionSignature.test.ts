import { describe, expect, it } from 'vitest';
import {
  createCompositionHistorySignature,
  createMediaFilesHistorySignature,
  createTimelineClipsHistorySignature,
} from '../../src/hooks/useGlobalHistory';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';
import { createMockClip } from '../helpers/mockData';

function composition(overrides: Partial<Composition> = {}): Composition {
  return {
    id: overrides.id ?? 'comp-1',
    name: overrides.name ?? 'Main',
    type: 'composition',
    parentId: overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? 1,
    width: overrides.width ?? 1920,
    height: overrides.height ?? 1080,
    frameRate: overrides.frameRate ?? 30,
    duration: overrides.duration ?? 60,
    backgroundColor: overrides.backgroundColor ?? '#000000',
    timelineData: overrides.timelineData ?? {
      tracks: [],
      clips: [],
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

describe('createCompositionHistorySignature', () => {
  it('ignores active composition timelineData mirror changes', () => {
    const before = composition();
    const after = composition({
      timelineData: {
        ...before.timelineData!,
        clips: [
          {
            id: 'clip-1',
            trackId: 'video-1',
            name: 'Clip',
            mediaFileId: 'media-1',
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
            sourceType: 'video',
            transform: {
              position: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1 },
              rotation: { x: 0, y: 0, z: 0 },
              opacity: 1,
              blendMode: 'normal',
            },
            effects: [],
          },
        ],
      },
    });

    expect(createCompositionHistorySignature([after], 'comp-1'))
      .toBe(createCompositionHistorySignature([before], 'comp-1'));
  });

  it('ignores inactive composition view-state changes', () => {
    const before = composition({ id: 'nested-comp' });
    const after = composition({
      id: 'nested-comp',
      timelineData: {
        ...before.timelineData!,
        playheadPosition: 12.5,
        zoom: 180,
        scrollX: 420,
      },
    });

    expect(createCompositionHistorySignature([after], 'main-comp'))
      .toBe(createCompositionHistorySignature([before], 'main-comp'));
  });

  it('tracks inactive composition content changes', () => {
    const before = composition({ id: 'nested-comp' });
    const after = composition({
      id: 'nested-comp',
      timelineData: {
        ...before.timelineData!,
        tracks: [
          { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
        ],
      },
    });

    expect(createCompositionHistorySignature([after], 'main-comp'))
      .not.toBe(createCompositionHistorySignature([before], 'main-comp'));
  });

  it('tracks active composition settings changes', () => {
    const before = composition();
    const after = composition({ width: 1280 });

    expect(createCompositionHistorySignature([after], 'comp-1'))
      .not.toBe(createCompositionHistorySignature([before], 'comp-1'));
  });
});

describe('history trigger signatures', () => {
  it('ignores transient clip audio-analysis fields', () => {
    const before = createMockClip({
      id: 'clip-a',
      trackId: 'audio-1',
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform-a' },
      },
    });
    const after = {
      ...before,
      waveformGenerating: true,
      waveformProgress: 42,
      audioAnalysisJob: {
        jobId: 'job-a',
        kind: 'processed-waveform-pyramid',
        label: 'Processed Waveform',
        artifactKinds: ['processed-waveform-pyramid'],
        processed: true,
        progress: 42,
        phase: 'rendering-processed-audio',
        startedAt: '2026-05-29T08:00:00.000Z',
        updatedAt: '2026-05-29T08:00:01.000Z',
      },
      audioState: {
        ...before.audioState,
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform-b' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform-b' },
      },
    };

    expect(createTimelineClipsHistorySignature([after]))
      .toBe(createTimelineClipsHistorySignature([before]));
  });

  it('tracks real clip edits after ignoring analysis metadata', () => {
    const before = createMockClip({ id: 'clip-a', trackId: 'audio-1', effects: [] });
    const after = createMockClip({
      ...before,
      effects: [
        { id: 'fx-1', name: 'EQ', type: 'audio-eq', enabled: true, params: { band1k: 3 } },
      ],
    });

    expect(createTimelineClipsHistorySignature([after]))
      .not.toBe(createTimelineClipsHistorySignature([before]));
  });

  it('ignores transient media waveform fields', () => {
    const before: MediaFile = {
      id: 'media-a',
      name: 'dialog.wav',
      type: 'audio',
      parentId: null,
      createdAt: 1,
      url: 'blob:before',
    };
    const after: MediaFile = {
      ...before,
      url: 'blob:after',
      waveformProgress: 87,
      waveformStatus: 'generating',
      waveform: [0.1, 0.4],
      waveformChannels: [[0.1, 0.4]],
      audioAnalysisRefs: { waveformPyramidId: 'waveform-a' },
    };

    expect(createMediaFilesHistorySignature([after]))
      .toBe(createMediaFilesHistorySignature([before]));
  });

  it('ignores transient media generation progress fields', () => {
    const before: MediaFile = {
      id: 'media-a',
      name: 'dialog.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: 'blob:video',
    };
    const after: MediaFile = {
      ...before,
      importProgress: 45,
      proxyProgress: 62,
      audioProxyProgress: 31,
      sceneCutProgress: 78,
      transcriptFusionProgress: {
        phase: 'fusing',
        progress: 0.5,
      } as MediaFile['transcriptFusionProgress'],
    };

    expect(createMediaFilesHistorySignature([after]))
      .toBe(createMediaFilesHistorySignature([before]));
  });

  it('tracks real media file edits after ignoring waveform metadata', () => {
    const before: MediaFile = {
      id: 'media-a',
      name: 'dialog.wav',
      type: 'audio',
      parentId: null,
      createdAt: 1,
      url: 'blob:before',
    };
    const after: MediaFile = {
      ...before,
      name: 'renamed-dialog.wav',
    };

    expect(createMediaFilesHistorySignature([after]))
      .not.toBe(createMediaFilesHistorySignature([before]));
  });
});

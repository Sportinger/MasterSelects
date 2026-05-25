import { describe, expect, it } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

describe('timeline audio edit slice', () => {
  it('adds a non-destructive audio edit operation from the active region selection', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 10 },
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'stale-processed-waveform' },
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      audioRegionSelection: {
        clipId: 'audio-clip',
        trackId: 'audio-1',
        startTime: 2,
        endTime: 4,
        sourceInPoint: 2,
        sourceOutPoint: 4,
      },
    });

    const operationId = store.getState().applyAudioRegionEdit('invert-polarity');

    const updated = store.getState().clips[0];
    expect(operationId).toBeTruthy();
    expect(store.getState().audioRegionSelection).toBeNull();
    expect(updated.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationId,
        type: 'invert-polarity',
        enabled: true,
        timeRange: { start: 2, end: 4 },
      }),
    ]);
  });

  it('bypasses and removes audio edit operations without mutating source refs', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 10 },
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform' },
        editStack: [
          {
            id: 'edit-1',
            type: 'silence',
            enabled: true,
            params: {},
            timeRange: { start: 1, end: 2 },
            createdAt: 1,
          },
        ],
      },
    });
    const store = createTestTimelineStore({ clips: [clip] });

    store.getState().setClipAudioEditOperationEnabled('audio-clip', 'edit-1', false);

    let updated = store.getState().clips[0];
    expect(updated.audioState?.editStack?.[0]).toMatchObject({ id: 'edit-1', enabled: false });
    expect(updated.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();

    store.getState().removeClipAudioEditOperation('audio-clip', 'edit-1');

    updated = store.getState().clips[0];
    expect(updated.audioState?.editStack).toEqual([]);
    expect(updated.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
  });

  it('copies and pastes audio regions as non-destructive paste operations', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      mediaFileId: 'media-a',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-a' },
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      audioState: { sourceAudioRevisionId: 'rev-a' },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      audioRegionSelection: {
        clipId: 'audio-clip',
        trackId: 'audio-1',
        startTime: 2,
        endTime: 3,
        sourceInPoint: 2,
        sourceOutPoint: 3,
      },
    });

    expect(store.getState().copySelectedAudioRegion()).toBe(true);
    expect(store.getState().audioRegionClipboard).toMatchObject({
      sourceClipId: 'audio-clip',
      sourceMediaFileId: 'media-a',
      sourceAudioRevisionId: 'rev-a',
      sourceInPoint: 2,
      sourceOutPoint: 3,
      duration: 1,
    });

    store.getState().setAudioRegionSelection({
      clipId: 'audio-clip',
      trackId: 'audio-1',
      startTime: 6,
      endTime: 7,
      sourceInPoint: 6,
      sourceOutPoint: 7,
    });
    const operationId = store.getState().pasteAudioRegionToSelection();

    expect(operationId).toBeTruthy();
    expect(store.getState().clips[0].audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationId,
        type: 'paste',
        enabled: true,
        timeRange: { start: 6, end: 7 },
        params: expect.objectContaining({
          sourceClipId: 'audio-clip',
          sourceInPoint: 2,
          sourceOutPoint: 3,
          replaceSelection: true,
        }),
      }),
    ]);
  });

  it('does not edit audio clips on locked tracks', () => {
    const store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'audio-1', type: 'audio', locked: true }),
      ],
      clips: [
        createMockClip({
          id: 'audio-clip',
          trackId: 'audio-1',
          file: new File([], 'dialog.wav', { type: 'audio/wav' }),
          source: { type: 'audio', naturalDuration: 10 },
        }),
      ],
      audioRegionSelection: {
        clipId: 'audio-clip',
        trackId: 'audio-1',
        startTime: 1,
        endTime: 2,
        sourceInPoint: 1,
        sourceOutPoint: 2,
      },
    });

    expect(store.getState().applyAudioRegionEdit('silence')).toBeNull();
    expect(store.getState().clips[0].audioState).toBeUndefined();
  });
});

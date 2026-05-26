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

  it('adds a non-destructive spectral edit operation from the active time-frequency selection', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 10 },
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      audioState: {
        sourceAnalysisRefs: { spectrogramTileSetIds: ['source-spectrum'] },
        processedAnalysisRefs: { spectrogramTileSetIds: ['processed-spectrum'] },
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      audioSpectralRegionSelection: {
        clipId: 'audio-clip',
        trackId: 'audio-1',
        startTime: 2,
        endTime: 4,
        sourceInPoint: 2,
        sourceOutPoint: 4,
        frequencyMinHz: 240,
        frequencyMaxHz: 2400,
      },
    });

    const operationId = store.getState().applySpectralRegionEdit('spectral-mask');

    const updated = store.getState().clips[0];
    expect(operationId).toBeTruthy();
    expect(store.getState().audioSpectralRegionSelection).toBeNull();
    expect(updated.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds).toEqual(['source-spectrum']);
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationId,
        type: 'spectral-mask',
        enabled: true,
        timeRange: { start: 2, end: 4 },
        params: expect.objectContaining({
          frequencyMinHz: 240,
          frequencyMaxHz: 2400,
          selectionMode: 'rectangle',
          blendMode: 'attenuate',
        }),
      }),
    ]);
  });

  it('persists spectral brush metadata on non-destructive spectral operations', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 10 },
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      audioState: {
        sourceAnalysisRefs: { spectrogramTileSetIds: ['source-spectrum'] },
        processedAnalysisRefs: { spectrogramTileSetIds: ['processed-spectrum'] },
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      audioSpectralRegionSelection: {
        clipId: 'audio-clip',
        trackId: 'audio-1',
        startTime: 2.75,
        endTime: 3.25,
        sourceInPoint: 2.75,
        sourceOutPoint: 3.25,
        frequencyMinHz: 800,
        frequencyMaxHz: 1600,
        selectionMode: 'brush',
        brushTimeRadiusSeconds: 0.25,
        brushFrequencyRadiusHz: 400,
      },
    });

    const operationId = store.getState().applySpectralRegionEdit('spectral-resynthesis');

    expect(operationId).toBeTruthy();
    expect(store.getState().clips[0].audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationId,
        type: 'spectral-resynthesis',
        timeRange: { start: 2.75, end: 3.25 },
        params: expect.objectContaining({
          selectionMode: 'brush',
          brushShape: 'soft-ellipse',
          brushTimeRadiusSeconds: 0.25,
          brushFrequencyRadiusHz: 400,
          featherTime: 0.175,
          featherFrequencyHz: 176,
          blendMode: 'replace',
        }),
      }),
    ]);
  });

  it('adds image-in-spectrum layers and invalidates only processed analysis refs', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 10 },
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      audioState: {
        sourceAnalysisRefs: { spectrogramTileSetIds: ['source-spectrum'] },
        processedAnalysisRefs: { spectrogramTileSetIds: ['processed-spectrum'] },
      },
    });
    const store = createTestTimelineStore({ clips: [clip] });

    const layerId = store.getState().addClipSpectralImageLayer('audio-clip', {
      imageMediaFileId: 'image-1',
      timeStart: -1,
      duration: 2,
      frequencyMin: 4000,
      frequencyMax: 200,
      opacity: 2,
      blendMode: 'attenuate',
      gainDb: -80,
      featherTime: -2,
      featherFrequency: 120,
      keyframes: [
        { id: 'kf-2', time: 5, opacity: 2, gainDb: 48, frequencyMin: 5000, frequencyMax: 1000 },
        { id: 'kf-1', time: -1, opacity: -1, gainDb: -90, frequencyMin: -20, frequencyMax: 300 },
      ],
    });

    const updated = store.getState().clips[0];
    expect(layerId).toBeTruthy();
    expect(updated.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds).toEqual(['source-spectrum']);
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.spectralLayers).toEqual([
      expect.objectContaining({
        id: layerId,
        imageMediaFileId: 'image-1',
        timeStart: 0,
        duration: 2,
        frequencyMin: 200,
        frequencyMax: 4000,
        opacity: 1,
        blendMode: 'attenuate',
        gainDb: -60,
        featherTime: 0,
        featherFrequency: 120,
        keyframes: [
          {
            id: 'kf-1',
            time: 0,
            opacity: 0,
            gainDb: -60,
            frequencyMin: 0,
            frequencyMax: 300,
          },
          {
            id: 'kf-2',
            time: 2,
            opacity: 1,
            gainDb: 24,
            frequencyMin: 1000,
            frequencyMax: 5000,
          },
        ],
      }),
    ]);
  });

  it('adds repair operations to the same non-destructive region edit stack', () => {
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
        processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform' },
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      audioRegionSelection: {
        clipId: 'audio-clip',
        trackId: 'audio-1',
        startTime: 1,
        endTime: 3,
        sourceInPoint: 1,
        sourceOutPoint: 3,
      },
    });

    const operationId = store.getState().applyAudioRegionEdit('repair', {
      params: {
        label: 'Hum notch',
        repairType: 'hum-notch',
        baseFrequencyHz: 50,
        harmonicCount: 6,
      },
    });

    const updated = store.getState().clips[0];
    expect(operationId).toBeTruthy();
    expect(updated.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationId,
        type: 'repair',
        enabled: true,
        timeRange: { start: 1, end: 3 },
        params: expect.objectContaining({
          label: 'Hum notch',
          repairType: 'hum-notch',
          baseFrequencyHz: 50,
        }),
      }),
    ]);
  });

  it('applies cached repair suggestions as whole-clip non-destructive edit operations', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 12 },
      startTime: 5,
      duration: 6,
      inPoint: 2,
      outPoint: 8,
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform' },
        processedAnalysisRefs: { loudnessEnvelopeId: 'processed-loudness' },
      },
    });
    const store = createTestTimelineStore({ clips: [clip] });

    const operationId = store.getState().applyAudioRepairSuggestion('audio-clip', {
      id: 'audio-repair:hum-notch',
      kind: 'hum-notch',
      label: '50 Hz hum notch',
      severity: 'warning',
      confidence: 0.84,
      reason: '50 Hz carries concentrated low-frequency energy.',
      operation: {
        editType: 'repair',
        params: {
          repairType: 'hum-notch',
          baseFrequencyHz: 50,
          harmonicCount: 6,
          q: 35,
        },
      },
      evidence: {
        energyShare: 0.24,
        peakDb: -12,
      },
    });

    const updated = store.getState().clips[0];
    expect(operationId).toBeTruthy();
    expect(updated.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationId,
        type: 'repair',
        enabled: true,
        timeRange: { start: 2, end: 8 },
        params: expect.objectContaining({
          label: '50 Hz hum notch',
          timelineStart: 5,
          timelineEnd: 11,
          repairType: 'hum-notch',
          repairSuggestionId: 'audio-repair:hum-notch',
          repairSuggestionKind: 'hum-notch',
          repairSuggestionSeverity: 'warning',
          repairSuggestionConfidence: 0.84,
          repairSuggestionEvidence: JSON.stringify({ energyShare: 0.24, peakDb: -12 }),
        }),
      }),
    ]);
  });

  it('applies detected silence removal as compacting non-destructive delete operations', async () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 12 },
      startTime: 4,
      duration: 10,
      inPoint: 1,
      outPoint: 11,
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform' },
      },
    });
    const store = createTestTimelineStore({
      clips: [
        clip,
        createMockClip({
          id: 'next-clip',
          trackId: 'audio-1',
          startTime: 15,
          duration: 3,
        }),
      ],
    });

    const operationIds = await store.getState().applyDetectedSilenceRemoval('audio-clip', {
      ranges: [
        { start: 2, end: 3, duration: 1, rmsDb: -82 },
        { start: 5, end: 5.5, duration: 0.5, rmsDb: -76 },
      ],
      detection: {
        thresholdDb: -55,
        minSilenceSeconds: 0.25,
      },
      rippleTimeline: true,
    });

    const updated = store.getState().clips.find(currentClip => currentClip.id === 'audio-clip');
    const nextClip = store.getState().clips.find(currentClip => currentClip.id === 'next-clip');
    expect(operationIds).toHaveLength(2);
    expect(updated?.duration).toBe(8.5);
    expect(nextClip?.startTime).toBe(13.5);
    expect(updated?.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
    expect(updated?.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated?.audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationIds[0],
        type: 'delete-silence',
        timeRange: { start: 2, end: 3 },
        params: expect.objectContaining({
          detectedSilence: true,
          compactTimeline: true,
          preserveClipDuration: false,
          silenceThresholdDb: -55,
          silenceRmsDb: -82,
          timelineStart: 5,
          timelineEnd: 6,
        }),
      }),
      expect.objectContaining({
        id: operationIds[1],
        timeRange: { start: 5, end: 5.5 },
        params: expect.objectContaining({
          sequenceIndex: 2,
          sequenceCount: 2,
        }),
      }),
    ]);
  });

  it('applies detected transient softening as non-destructive repair operations', async () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 8 },
      startTime: 4,
      duration: 6,
      inPoint: 1,
      outPoint: 7,
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform' },
      },
    });
    const store = createTestTimelineStore({ clips: [clip] });

    const operationIds = await store.getState().applyDetectedTransientSoftening('audio-clip', {
      ranges: [
        { start: 2, end: 2.04, duration: 0.04, peakDb: -1.2, rmsDb: -24.4, crestDb: 23.2, strength: 7.1 },
      ],
      detection: {
        crestThresholdDb: 18,
        minPeakDb: -8,
      },
      gainDb: -9,
    });

    const updated = store.getState().clips[0];
    expect(operationIds).toHaveLength(1);
    expect(updated.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationIds[0],
        type: 'repair',
        enabled: true,
        timeRange: { start: 2, end: 2.04 },
        params: expect.objectContaining({
          label: 'Soften detected transient',
          repairType: 'transient-soften',
          detectedTransient: true,
          preserveClipDuration: true,
          gainDb: -9,
          transientPeakDb: -1.2,
          transientRmsDb: -24.4,
          transientCrestDb: 23.2,
          timelineStart: 5,
        }),
      }),
    ]);
  });

  it('applies room tone fill to the selected audio region using detected source ranges', async () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      source: { type: 'audio', naturalDuration: 12 },
      startTime: 4,
      duration: 10,
      inPoint: 1,
      outPoint: 11,
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform' },
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      audioRegionSelection: {
        clipId: 'audio-clip',
        trackId: 'audio-1',
        startTime: 6,
        endTime: 7,
        sourceInPoint: 3,
        sourceOutPoint: 4,
      },
    });

    const operationId = await store.getState().applyRoomToneFill('audio-clip', {
      sourceRanges: [
        { start: 1.5, end: 2.25, duration: 0.75, rmsDb: -72 },
      ],
      gainDb: -3,
      crossfadeSeconds: 0.04,
    });

    const updated = store.getState().clips[0];
    expect(operationId).toBeTruthy();
    expect(updated.duration).toBe(10);
    expect(updated.audioState?.sourceAnalysisRefs?.waveformPyramidId).toBe('source-waveform');
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(updated.audioState?.editStack).toEqual([
      expect.objectContaining({
        id: operationId,
        type: 'room-tone-fill',
        enabled: true,
        timeRange: { start: 3, end: 4 },
        params: expect.objectContaining({
          label: 'Room tone fill',
          timelineStart: 6,
          timelineEnd: 7,
          roomToneGainDb: -3,
          crossfadeSeconds: 0.04,
          roomToneSourceCount: 1,
          sourceInPoint: 1.5,
          sourceOutPoint: 2.25,
        }),
      }),
    ]);
    expect(updated.audioState?.editStack?.[0].params.roomToneSourceRanges).toBe(JSON.stringify([
      { start: 1.5, end: 2.25, duration: 0.75, rmsDb: -72 },
    ]));
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

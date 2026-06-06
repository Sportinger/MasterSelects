import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip } from '../../helpers/mockData';
import type { ClipAudioStemState, TimelineClip } from '../../../src/types';
import {
  setClipStemSeparationRunner,
} from '../../../src/stores/timeline/stemSeparationSlice';
import { STEM_SOURCE_LAYER_ID } from '../../../src/services/audio/stemSeparation';
import { useMediaStore } from '../../../src/stores/mediaStore';
import type { MediaFile } from '../../../src/stores/mediaStore/types';

const SOURCE_REFS = { waveformPyramidId: 'source-waveform' };
const PROCESSED_REFS = { processedWaveformPyramidId: 'processed-waveform' };
const EMPTY_MEDIA_STORE_STATE = useMediaStore.getState();

function createStemState(overrides: Partial<ClipAudioStemState> = {}): ClipAudioStemState {
  return {
    activeSetId: 'stem-set-1',
    modelId: 'demucs-htdemucs-web',
    modelVersion: 'test-model-v1',
    createdAt: 1_777_000_000_000,
    sourceFingerprint: 'sha256:source',
    range: { start: 0, end: 10 },
    sampleRate: 48_000,
    channelCount: 2,
    mixMode: 'stems',
    stems: [
      {
        id: 'stem-vocals',
        kind: 'vocals',
        label: 'Vocals',
        analysisArtifactId: 'analysis-vocals',
        manifestArtifactId: 'manifest-vocals',
        payloadRef: { artifactId: 'payload-vocals' },
        mediaFileId: 'media-stem-vocals',
        enabled: true,
        gainDb: 0,
        phaseAligned: true,
        modelId: 'demucs-htdemucs-web',
        sourceFingerprint: 'sha256:source',
      },
      {
        id: 'stem-drums',
        kind: 'drums',
        label: 'Drums',
        analysisArtifactId: 'analysis-drums',
        manifestArtifactId: 'manifest-drums',
        payloadRef: { artifactId: 'payload-drums' },
        mediaFileId: 'media-stem-drums',
        enabled: true,
        gainDb: 0,
        phaseAligned: true,
        modelId: 'demucs-htdemucs-web',
        sourceFingerprint: 'sha256:source',
      },
    ],
    ...overrides,
  };
}

function createAudioClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'audio-clip',
    trackId: 'audio-1',
    file: new File([], 'dialog.wav', { type: 'audio/wav' }),
    source: { type: 'audio', naturalDuration: 10 },
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    audioState: {
      sourceAnalysisRefs: SOURCE_REFS,
      processedAnalysisRefs: PROCESSED_REFS,
      stemSeparation: createStemState(),
    },
    ...overrides,
  });
}

function createLinkedVideoClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'video-clip',
    trackId: 'video-1',
    file: new File([], 'dialog.mp4', { type: 'video/mp4' }),
    source: { type: 'video', naturalDuration: 10 },
    linkedClipId: 'audio-clip',
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    ...overrides,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('timeline stem separation slice', () => {
  afterEach(() => {
    setClipStemSeparationRunner(null);
    vi.mocked(useMediaStore.getState).mockReturnValue({ ...EMPTY_MEDIA_STORE_STATE, files: [] });
  });

  it('applies stem solo to the linked audible audio clip and clears processed refs', () => {
    const audioClip = createAudioClip({ linkedClipId: 'video-clip' });
    const videoClip = createLinkedVideoClip();
    const store = createTestTimelineStore({ clips: [videoClip, audioClip] });

    store.getState().setClipStemSolo('video-clip', 'stem-vocals');

    const updatedAudioClip = store.getState().clips.find(clip => clip.id === 'audio-clip');
    const updatedVideoClip = store.getState().clips.find(clip => clip.id === 'video-clip');
    expect(updatedVideoClip?.audioState).toBeUndefined();
    expect(updatedAudioClip?.audioState?.stemSeparation?.soloStemId).toBe('stem-vocals');
    expect(updatedAudioClip?.audioState?.sourceAnalysisRefs).toBe(SOURCE_REFS);
    expect(updatedAudioClip?.audioState?.processedAnalysisRefs).toBeUndefined();

    store.getState().setClipStemSolo('audio-clip', null);
    expect(store.getState().clips.find(clip => clip.id === 'audio-clip')?.audioState?.stemSeparation?.soloStemId).toBeUndefined();
  });

  it('updates stem enabled and gain without mutating other stems', () => {
    const audioClip = createAudioClip();
    const store = createTestTimelineStore({ clips: [audioClip] });

    store.getState().setClipStemEnabled('audio-clip', 'stem-drums', false);
    store.getState().setClipStemGain('audio-clip', 'stem-drums', 6.5);

    const stemState = store.getState().clips[0].audioState?.stemSeparation;
    expect(stemState?.stems.find(stem => stem.id === 'stem-vocals')).toMatchObject({
      enabled: true,
      gainDb: 0,
    });
    expect(stemState?.stems.find(stem => stem.id === 'stem-drums')).toMatchObject({
      enabled: false,
      gainDb: 6.5,
    });
    expect(store.getState().clips[0].audioState?.sourceAnalysisRefs).toBe(SOURCE_REFS);
    expect(store.getState().clips[0].audioState?.processedAnalysisRefs).toBeUndefined();
  });

  it('switches between original source and stem mix modes', () => {
    const audioClip = createAudioClip();
    const store = createTestTimelineStore({ clips: [audioClip] });

    store.getState().setClipStemMixMode('audio-clip', 'original');
    expect(store.getState().clips[0].audioState?.stemSeparation?.mixMode).toBe('original');

    store.getState().setClipStemGain('audio-clip', 'stem-drums', 3);
    expect(store.getState().clips[0].audioState?.stemSeparation?.mixMode).toBe('stems');
  });

  it('clears stem state', () => {
    const audioClip = createAudioClip();
    const store = createTestTimelineStore({ clips: [audioClip] });

    store.getState().clearClipStemSeparation('audio-clip');

    const updated = store.getState().clips[0];
    expect(updated.audioState?.stemSeparation).toBeUndefined();
    expect(updated.audioState?.sourceAnalysisRefs).toBe(SOURCE_REFS);
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
  });

  it('starts separation through the runner for a linked video and commits returned stems to audio', async () => {
    const audioClip = createAudioClip({
      linkedClipId: 'video-clip',
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-dialog' },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
      },
    });
    const copiedAudioClip = createAudioClip({
      id: 'audio-copy',
      startTime: 12,
      inPoint: 2,
      outPoint: 8,
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-dialog' },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
      },
    });
    const videoClip = createLinkedVideoClip();
    const stemState = createStemState({ activeSetId: 'stem-set-generated' });
    const runner = vi.fn(async (request) => {
      request.updateProgress({ phase: 'separating', progress: 0.5, backend: 'webgpu' });
      return stemState;
    });
    setClipStemSeparationRunner(runner);
    const store = createTestTimelineStore({ clips: [videoClip, audioClip, copiedAudioClip] });

    const jobId = await store.getState().startClipStemSeparation('video-clip');
    await flushPromises();

    expect(jobId).toBeTruthy();
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      clip: expect.objectContaining({ id: 'audio-clip' }),
      requestedClip: expect.objectContaining({ id: 'video-clip' }),
    }));
    expect(store.getState().clipStemSeparationJobs['audio-clip']).toMatchObject({
      jobId,
      clipId: 'audio-clip',
      requestedClipId: 'video-clip',
      sourceMediaFileId: 'media-dialog',
      phase: 'complete',
      progress: 1,
      backend: 'webgpu',
      stems: [
        {
          id: 'stem-vocals',
          kind: 'vocals',
          label: 'Vocals',
          mediaFileId: 'media-stem-vocals',
        },
        {
          id: 'stem-drums',
          kind: 'drums',
          label: 'Drums',
          mediaFileId: 'media-stem-drums',
        },
      ],
    });
    const updatedAudioClip = store.getState().clips.find(clip => clip.id === 'audio-clip');
    const updatedCopiedAudioClip = store.getState().clips.find(clip => clip.id === 'audio-copy');
    expect(updatedAudioClip?.audioState?.stemSeparation).toBeUndefined();
    expect(updatedAudioClip?.audioState?.sourceAnalysisRefs).toBe(SOURCE_REFS);
    expect(updatedAudioClip?.audioState?.processedAnalysisRefs).toBe(PROCESSED_REFS);
    expect(updatedCopiedAudioClip?.audioState?.stemSeparation).toBeUndefined();
    expect(updatedCopiedAudioClip?.audioState?.sourceAnalysisRefs).toBe(SOURCE_REFS);
    expect(updatedCopiedAudioClip?.audioState?.processedAnalysisRefs).toBe(PROCESSED_REFS);
  });

  it('switches the resolved audio clip source to a generated stem media file', () => {
    const sourceFile = new File([], 'dialog.wav', { type: 'audio/wav' });
    const sourceMediaFile: MediaFile = {
      id: 'media-dialog',
      name: 'dialog.wav',
      type: 'audio',
      parentId: null,
      createdAt: 1_777_000_000_000,
      file: sourceFile,
      url: 'blob:source',
      duration: 10,
      waveform: [0.1, 0.3],
      waveformChannels: [[0.1, 0.3]],
      waveformStatus: 'ready',
      audioAnalysisRefs: SOURCE_REFS,
    };
    const stemFile = new File([], 'dialog - vocals.wav', { type: 'audio/wav' });
    const stemMediaFile: MediaFile = {
      id: 'media-stem-vocals',
      name: 'Vocals',
      type: 'audio',
      parentId: null,
      createdAt: 1_777_000_000_001,
      file: stemFile,
      url: 'blob:stem-vocals',
      duration: 10,
      waveform: [0.2, 0.4],
      waveformChannels: [[0.2, 0.4]],
      waveformStatus: 'ready',
      audioAnalysisRefs: { waveformPyramidId: 'stem-waveform' },
    };
    vi.mocked(useMediaStore.getState).mockReturnValue({ ...EMPTY_MEDIA_STORE_STATE, files: [sourceMediaFile, stemMediaFile] });

    const effects = [{ id: 'fx-1', name: 'blur', type: 'blur' as const, enabled: true, params: { radius: 4 } }];
    const staleAudioElement = document.createElement('audio');
    const audioClip = createAudioClip({
      linkedClipId: 'video-clip',
      duration: 5,
      inPoint: 2,
      outPoint: 7,
      effects,
      source: {
        type: 'audio',
        naturalDuration: 10,
        mediaFileId: 'media-dialog',
        audioElement: staleAudioElement,
      },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
        stemSeparation: createStemState(),
      },
    });
    const videoClip = createLinkedVideoClip();
    const store = createTestTimelineStore({ clips: [videoClip, audioClip] });

    expect(store.getState().setClipSourceToStem('video-clip', 'media-stem-vocals')).toBe(true);

    const updatedVideoClip = store.getState().clips.find(clip => clip.id === 'video-clip');
    const updatedAudioClip = store.getState().clips.find(clip => clip.id === 'audio-clip');
    expect(updatedVideoClip?.source?.mediaFileId).toBeUndefined();
    expect(updatedAudioClip).toMatchObject({
      id: 'audio-clip',
      file: stemFile,
      mediaFileId: 'media-stem-vocals',
      duration: 5,
      inPoint: 2,
      outPoint: 7,
      effects,
      waveform: [0.2, 0.4],
      waveformChannels: [[0.2, 0.4]],
      waveformGenerating: false,
      waveformProgress: 100,
    });
    expect(updatedAudioClip?.source).toMatchObject({
      type: 'audio',
      naturalDuration: 10,
      mediaFileId: 'media-stem-vocals',
      file: stemFile,
    });
    expect(updatedAudioClip?.source).not.toHaveProperty('audioElement');
    expect(updatedAudioClip?.audioState).toMatchObject({
      sourceAudioRevisionId: 'media-stem-vocals',
      sourceAnalysisRefs: { waveformPyramidId: 'stem-waveform' },
    });
    expect(updatedAudioClip?.audioState?.stemSeparation).toBeUndefined();
    expect(updatedAudioClip?.audioState?.processedAnalysisRefs).toBeUndefined();

    expect(store.getState().setClipSourceToStem('video-clip', 'media-dialog')).toBe(true);

    const restoredAudioClip = store.getState().clips.find(clip => clip.id === 'audio-clip');
    expect(restoredAudioClip).toMatchObject({
      file: sourceFile,
      mediaFileId: 'media-dialog',
      waveform: [0.1, 0.3],
      waveformChannels: [[0.1, 0.3]],
    });
    expect(restoredAudioClip?.source).toMatchObject({
      type: 'audio',
      mediaFileId: 'media-dialog',
      file: sourceFile,
    });
    expect(restoredAudioClip?.source).not.toHaveProperty('audioElement');
    expect(restoredAudioClip?.audioState).toMatchObject({
      sourceAudioRevisionId: 'media-dialog',
      sourceAnalysisRefs: SOURCE_REFS,
    });
  });

  it('relinks completed stem choices from media library metadata after reload', () => {
    const audioClip = createAudioClip({
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-dialog' },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
      },
    });
    const stemFile = new File([], 'dialog - vocals.wav', { type: 'audio/wav' });
    const stemMediaFile: MediaFile = {
      id: 'media-stem-vocals',
      name: 'dialog - vocals.wav',
      type: 'audio',
      parentId: null,
      createdAt: 1_777_000_000_001,
      file: stemFile,
      url: 'blob:stem-vocals',
      duration: 10,
      stemInfo: {
        schemaVersion: 1,
        sourceMediaFileId: 'media-dialog',
        sourceFingerprint: 'sha256:source',
        activeSetId: 'stem-set-1',
        modelId: 'demucs-htdemucs-web',
        modelVersion: 'test-model-v1',
        kind: 'vocals',
        label: 'Vocals',
        createdAt: 1_777_000_000_001,
      },
    };
    vi.mocked(useMediaStore.getState).mockReturnValue({ ...EMPTY_MEDIA_STORE_STATE, files: [stemMediaFile], folders: [] });
    const store = createTestTimelineStore({ clips: [audioClip] });

    expect(store.getState().relinkClipStemSeparationJobsFromMediaLibrary()).toBe(1);

    expect(store.getState().clipStemSeparationJobs['audio-clip']).toMatchObject({
      jobId: 'stem-relink:media-dialog',
      clipId: 'audio-clip',
      requestedClipId: 'audio-clip',
      sourceMediaFileId: 'media-dialog',
      modelId: 'demucs-htdemucs-web',
      phase: 'complete',
      progress: 1,
      stems: [
        {
          id: 'media-stem-vocals:vocals',
          kind: 'vocals',
          label: 'Vocals',
          mediaFileId: 'media-stem-vocals',
        },
      ],
    });
  });

  it('relinks legacy stem media files from the Stems folder when metadata is missing', () => {
    const audioClip = createAudioClip({
      name: 'dialog.wav',
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-dialog' },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
      },
    });
    const sourceMediaFile: MediaFile = {
      id: 'media-dialog',
      name: 'dialog.wav',
      type: 'audio',
      parentId: null,
      createdAt: 1_777_000_000_000,
      file: new File([], 'dialog.wav', { type: 'audio/wav' }),
      url: 'blob:dialog',
      duration: 10,
    };
    const stemMediaFile: MediaFile = {
      id: 'media-stem-drums',
      name: 'dialog - Drums.wav',
      type: 'audio',
      parentId: 'stem-source-folder',
      createdAt: 1_777_000_000_001,
      file: new File([], 'dialog - Drums.wav', { type: 'audio/wav' }),
      url: 'blob:stem-drums',
      duration: 10,
      projectPath: 'Stems/dialog/dialog - Drums.wav',
    };
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...EMPTY_MEDIA_STORE_STATE,
      files: [sourceMediaFile, stemMediaFile],
      folders: [
        { id: 'stem-root-folder', name: 'Stems', parentId: null, isExpanded: true, createdAt: 1_777_000_000_000 },
        { id: 'stem-source-folder', name: 'dialog', parentId: 'stem-root-folder', isExpanded: true, createdAt: 1_777_000_000_000 },
      ],
    });
    const store = createTestTimelineStore({ clips: [audioClip] });

    expect(store.getState().relinkClipStemSeparationJobsFromMediaLibrary()).toBe(1);
    expect(store.getState().clipStemSeparationJobs['audio-clip'].sourceMediaFileId).toBe('media-dialog');
    expect(store.getState().clipStemSeparationJobs['audio-clip'].stems).toEqual([
      {
        id: 'media-stem-drums:drums',
        kind: 'drums',
        label: 'Drums',
        mediaFileId: 'media-stem-drums',
      },
    ]);
  });

  it('shares an existing stem separation with same-source clip copies', () => {
    const stemState = createStemState({ activeSetId: 'stem-set-existing' });
    const audioClip = createAudioClip({
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-dialog' },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
        stemSeparation: stemState,
      },
    });
    const copiedAudioClip = createAudioClip({
      id: 'audio-copy',
      startTime: 4,
      inPoint: 1,
      outPoint: 5,
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-dialog' },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
      },
    });
    const unrelatedStemState = createStemState({ activeSetId: 'stem-set-unrelated' });
    const unrelatedAudioClip = createAudioClip({
      id: 'audio-unrelated',
      source: { type: 'audio', naturalDuration: 10, mediaFileId: 'other-media' },
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
        stemSeparation: unrelatedStemState,
      },
    });
    const store = createTestTimelineStore({ clips: [audioClip, copiedAudioClip, unrelatedAudioClip] });

    expect(store.getState().syncClipStemSeparationCopies('audio-clip')).toBe(1);

    const copiedStemState = store.getState().clips.find(clip => clip.id === 'audio-copy')?.audioState?.stemSeparation;
    expect(copiedStemState).toMatchObject({
      activeSetId: 'stem-set-existing',
      mixMode: 'original',
      soloStemId: STEM_SOURCE_LAYER_ID,
      sourceGainDb: 0,
    });
    expect(copiedStemState?.stems).toEqual(stemState.stems);
    expect(store.getState().clips.find(clip => clip.id === 'audio-copy')?.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(store.getState().clips.find(clip => clip.id === 'audio-unrelated')?.audioState?.stemSeparation).toEqual(unrelatedStemState);
  });

  it('cancels active separation jobs without changing persistent clip audio state', async () => {
    let capturedSignal: AbortSignal | null = null;
    const runner = vi.fn((request) => {
      capturedSignal = request.signal;
      return new Promise<ClipAudioStemState | null>(() => {});
    });
    setClipStemSeparationRunner(runner);
    const audioClip = createAudioClip({
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
      },
    });
    const store = createTestTimelineStore({ clips: [audioClip] });

    const jobId = await store.getState().startClipStemSeparation('audio-clip');
    store.getState().cancelClipStemSeparation('audio-clip');

    expect(capturedSignal?.aborted).toBe(true);
    expect(store.getState().clipStemSeparationJobs['audio-clip']).toMatchObject({
      jobId,
      phase: 'cancelled',
    });
    expect(store.getState().clips[0].audioState).toEqual({ sourceAnalysisRefs: SOURCE_REFS });
  });
});

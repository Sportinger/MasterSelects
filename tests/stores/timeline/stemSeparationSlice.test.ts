import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip } from '../../helpers/mockData';
import type { ClipAudioStemState, TimelineClip } from '../../../src/types';
import {
  setClipStemSeparationRunner,
} from '../../../src/stores/timeline/stemSeparationSlice';

const SOURCE_REFS = { waveformPyramidId: 'source-waveform' };
const PROCESSED_REFS = { processedWaveformPyramidId: 'processed-waveform' };

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

  it('clears stem state and closes the transient dropdown', () => {
    const audioClip = createAudioClip();
    const store = createTestTimelineStore({ clips: [audioClip] });

    store.getState().setClipStemLayerDropdownOpen('audio-clip', true);
    store.getState().clearClipStemSeparation('audio-clip');

    const updated = store.getState().clips[0];
    expect(updated.audioState?.stemSeparation).toBeUndefined();
    expect(updated.audioState?.sourceAnalysisRefs).toBe(SOURCE_REFS);
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
    expect(store.getState().expandedClipStemLayerIds.has('audio-clip')).toBe(false);
  });

  it('keeps dropdown state transient without changing clip objects', () => {
    const audioClip = createAudioClip();
    const videoClip = createLinkedVideoClip();
    const store = createTestTimelineStore({ clips: [videoClip, audioClip] });
    const originalClips = store.getState().clips;

    store.getState().toggleClipStemLayerDropdown('video-clip');

    expect(store.getState().expandedClipStemLayerIds.has('audio-clip')).toBe(true);
    expect(store.getState().clips).toBe(originalClips);

    store.getState().setClipStemLayerDropdownOpen('video-clip', false);
    expect(store.getState().expandedClipStemLayerIds.has('audio-clip')).toBe(false);
    expect(store.getState().clips).toBe(originalClips);
  });

  it('starts separation through the runner for a linked video and commits returned stems to audio', async () => {
    const audioClip = createAudioClip({
      linkedClipId: 'video-clip',
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
    const store = createTestTimelineStore({ clips: [videoClip, audioClip] });

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
      phase: 'complete',
      progress: 1,
      backend: 'webgpu',
    });
    expect(store.getState().expandedClipStemLayerIds.has('audio-clip')).toBe(true);
    const updatedAudioClip = store.getState().clips.find(clip => clip.id === 'audio-clip');
    expect(updatedAudioClip?.audioState?.stemSeparation).toEqual(stemState);
    expect(updatedAudioClip?.audioState?.sourceAnalysisRefs).toBe(SOURCE_REFS);
    expect(updatedAudioClip?.audioState?.processedAnalysisRefs).toBeUndefined();
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

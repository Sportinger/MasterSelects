import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCompositionAudioMixdownCache,
  createCompositionMixdownAudioElement,
  getCompositionMixdownAudioElementResourceId,
  getCompositionMixdownBufferResourceId,
  getCompositionAudioMixdownCacheStats,
  getCompositionAudioMixdownKey,
  MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
  releaseCompositionMixdownAudioElementResource,
  releaseCompositionMixdownClipRuntime,
  requestCompositionAudioMixdown,
} from '../../src/services/timeline/compositionAudioMixdownCache';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { RenderResourceDescriptor } from '../../src/services/timeline/runtimeCoordinatorTypes';
import type { TimelineClip } from '../../src/types';

const compositionAudioMixerMocks = vi.hoisted(() => ({
  mixdownComposition: vi.fn(),
  createAudioElement: vi.fn(),
}));

vi.mock('../../src/services/compositionAudioMixer', () => ({
  compositionAudioMixer: compositionAudioMixerMocks,
}));

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'comp-audio',
    trackId: 'audio-1',
    name: 'Comp Audio',
    file: new File([], 'comp-audio.wav'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'audio', naturalDuration: 5 },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isComposition: true,
    compositionId: 'comp-1',
    nestedContentHash: 'hash-a',
    ...overrides,
  };
}

function audioBuffer(): AudioBuffer {
  return {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 48_000,
    duration: 1,
    getChannelData: () => new Float32Array(48_000),
  } as unknown as AudioBuffer;
}

function retainedInteractiveAudioResource(index: number): RenderResourceDescriptor {
  return {
    id: `retained-interactive-audio-${index}`,
    kind: 'html-media',
    policyId: 'interactive',
    owner: {
      ownerId: `retained-interactive-audio-${index}`,
      ownerType: 'timeline',
    },
    mediaElementKind: 'audio',
    elementId: `retained-interactive-audio-${index}`,
  };
}

function retainedInteractiveHeapResource(heapBytes: number): RenderResourceDescriptor {
  return {
    id: 'retained-interactive-heap',
    kind: 'runtime-binding',
    policyId: 'interactive',
    owner: {
      ownerId: 'retained-interactive-heap',
      ownerType: 'timeline',
    },
    runtime: {
      runtimeSourceId: 'retained-interactive-heap',
      runtimeSessionKey: 'retained-interactive-heap',
    },
    memoryCost: {
      heapBytes,
    },
  };
}

describe('compositionAudioMixdownCache', () => {
  afterEach(() => {
    clearCompositionAudioMixdownCache();
    timelineRuntimeCoordinator.clearResources();
    compositionAudioMixerMocks.mixdownComposition.mockReset();
    compositionAudioMixerMocks.createAudioElement.mockReset();
  });

  it('dedupes concurrent mixdown requests by composition id and content hash', async () => {
    const buffer = audioBuffer();
    compositionAudioMixerMocks.mixdownComposition.mockResolvedValue({
      buffer,
      waveform: [0, 0.5],
      duration: 1,
      hasAudio: true,
    });

    const first = requestCompositionAudioMixdown(clip());
    const second = requestCompositionAudioMixdown(clip());
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledOnce();
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledWith('comp-1');
    expect(firstResult).toBe(secondResult);
    expect(firstResult).toEqual(expect.objectContaining({
      key: 'comp-1:hash-a',
      buffer,
      waveform: [0, 0.5],
      hasAudio: true,
    }));
  });

  it('uses an existing clip mixdown buffer without calling the mixer', async () => {
    const buffer = audioBuffer();

    const result = await requestCompositionAudioMixdown(clip({
      mixdownBuffer: buffer,
      mixdownWaveform: [0.25],
    }));

    expect(compositionAudioMixerMocks.mixdownComposition).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      key: 'comp-1:hash-a',
      buffer,
      waveform: [0.25],
      hasAudio: true,
    }));
  });

  it('returns null when a clip has no composition id', async () => {
    expect(getCompositionAudioMixdownKey({ compositionId: undefined, nestedContentHash: 'hash-a' })).toBeNull();
    await expect(requestCompositionAudioMixdown(clip({ compositionId: undefined }))).resolves.toBeNull();
    expect(compositionAudioMixerMocks.mixdownComposition).not.toHaveBeenCalled();
  });

  it('bounds completed mixdown retention by least-recently-used content hash', async () => {
    compositionAudioMixerMocks.mixdownComposition.mockImplementation(async () => ({
      buffer: audioBuffer(),
      waveform: [0, 0.25],
      duration: 1,
      hasAudio: true,
    }));

    for (let index = 0; index < MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 2; index += 1) {
      await requestCompositionAudioMixdown(clip({ nestedContentHash: `hash-${index}` }));
    }

    expect(getCompositionAudioMixdownCacheStats()).toMatchObject({
      completedCount: MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
      maxCompletedCount: MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
    });
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledTimes(MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 2);

    await requestCompositionAudioMixdown(clip({ nestedContentHash: 'hash-0' }));
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledTimes(MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 3);

    await requestCompositionAudioMixdown(clip({ nestedContentHash: `hash-${MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 1}` }));
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledTimes(MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 3);
  });

  it('reports completed mixdown buffers and releases them when the cache clears', async () => {
    const buffer = audioBuffer();
    compositionAudioMixerMocks.mixdownComposition.mockResolvedValue({
      buffer,
      waveform: [0, 0.25],
      duration: 1,
      hasAudio: true,
    });

    await requestCompositionAudioMixdown(clip());

    const resourceId = getCompositionMixdownBufferResourceId('comp-1:hash-a');
    const resource = timelineRuntimeCoordinator
      .getBridgeStats()
      .policies.interactive.resources
      .find(candidate => candidate.id === resourceId);
    expect(resource).toMatchObject({
      id: resourceId,
      kind: 'runtime-binding',
      policyId: 'interactive',
      owner: {
        ownerId: 'composition-audio-mixdown-cache',
        ownerType: 'timeline',
        compositionId: 'comp-1',
      },
      source: {
        sourceId: 'comp-1:hash-a',
        compositionId: 'comp-1',
      },
      runtime: {
        runtimeSessionKey: 'comp-1:hash-a',
      },
      dimensions: {
        durationSeconds: 1,
        sampleRate: 48_000,
        channelCount: 2,
      },
      memoryCost: {
        heapBytes: 48_000 * 2 * Float32Array.BYTES_PER_ELEMENT,
      },
    });

    clearCompositionAudioMixdownCache();

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resourceId })]));
  });

  it('releases completed mixdown buffer resources on LRU eviction', async () => {
    compositionAudioMixerMocks.mixdownComposition.mockImplementation(async () => ({
      buffer: audioBuffer(),
      waveform: [0, 0.25],
      duration: 1,
      hasAudio: true,
    }));

    for (let index = 0; index < MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS + 1; index += 1) {
      await requestCompositionAudioMixdown(clip({ nestedContentHash: `lru-${index}` }));
    }

    const evictedResourceId = getCompositionMixdownBufferResourceId('comp-1:lru-0');
    const retainedResourceId = getCompositionMixdownBufferResourceId(`comp-1:lru-${MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS}`);
    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: evictedResourceId })]));
    expect(resources).toEqual(expect.arrayContaining([expect.objectContaining({ id: retainedResourceId })]));
  });

  it('skips completed mixdown cache retention when the interactive heap budget is full', async () => {
    timelineRuntimeCoordinator.retainResource(retainedInteractiveHeapResource(512 * 1024 * 1024));
    compositionAudioMixerMocks.mixdownComposition.mockResolvedValue({
      buffer: audioBuffer(),
      waveform: [0, 0.25],
      duration: 1,
      hasAudio: true,
    });

    await requestCompositionAudioMixdown(clip());
    await requestCompositionAudioMixdown(clip());

    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledTimes(2);
    expect(getCompositionAudioMixdownCacheStats().completedCount).toBe(0);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: getCompositionMixdownBufferResourceId('comp-1:hash-a') }),
      ]));
  });

  it('reports composition mixdown playback audio elements and releases them by clip id', () => {
    const buffer = audioBuffer();
    const audioElement = document.createElement('audio');
    compositionAudioMixerMocks.createAudioElement.mockReturnValue(audioElement);

    expect(createCompositionMixdownAudioElement('comp-audio', buffer, { compositionId: 'comp-1' }))
      .toBe(audioElement);

    expect(compositionAudioMixerMocks.createAudioElement)
      .toHaveBeenCalledWith(buffer, { ownerClipId: 'comp-audio' });
    const resourceId = getCompositionMixdownAudioElementResourceId('comp-audio');
    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.interactive;
    const resource = stats.resources.find(candidate => candidate.id === resourceId);
    expect(resource).toMatchObject({
      kind: 'html-media',
      policyId: 'interactive',
      mediaElementKind: 'audio',
      srcKind: 'blob-url',
      owner: {
        ownerId: 'composition-audio-mixdown:comp-audio',
        ownerType: 'clip',
        clipId: 'comp-audio',
        compositionId: 'comp-1',
      },
      source: {
        clipId: 'comp-audio',
        compositionId: 'comp-1',
      },
      dimensions: {
        durationSeconds: 1,
        sampleRate: 48_000,
        channelCount: 2,
      },
      memoryCost: {
        heapBytes: 48_000 * 2 * Float32Array.BYTES_PER_ELEMENT,
      },
    });
    expect(stats.budgetReport.usage.htmlMediaElements).toBe(1);
    expect(stats.budgetReport.usage.audioSources).toBe(1);

    releaseCompositionMixdownAudioElementResource('comp-audio');

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resourceId })]));
  });

  it('releases clip-scoped playback and cached-buffer mixdown runtime together', async () => {
    const buffer = audioBuffer();
    const audioElement = document.createElement('audio');
    compositionAudioMixerMocks.mixdownComposition.mockResolvedValue({
      buffer,
      waveform: [0, 0.25],
      duration: 1,
      hasAudio: true,
    });
    compositionAudioMixerMocks.createAudioElement.mockReturnValue(audioElement);

    await requestCompositionAudioMixdown(clip());
    createCompositionMixdownAudioElement('comp-audio', buffer, { compositionId: 'comp-1' });

    const bufferResourceId = getCompositionMixdownBufferResourceId('comp-1:hash-a');
    const elementResourceId = getCompositionMixdownAudioElementResourceId('comp-audio');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: bufferResourceId }),
        expect.objectContaining({ id: elementResourceId }),
      ]));

    releaseCompositionMixdownClipRuntime(clip());

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: bufferResourceId }),
        expect.objectContaining({ id: elementResourceId }),
      ]));
  });

  it('denies composition mixdown playback audio before creating an element when the policy is full', () => {
    for (let index = 0; index < 8; index += 1) {
      timelineRuntimeCoordinator.retainResource(retainedInteractiveAudioResource(index));
    }

    expect(createCompositionMixdownAudioElement('denied-comp-audio', audioBuffer(), { compositionId: 'comp-1' }))
      .toBeNull();

    expect(compositionAudioMixerMocks.createAudioElement).not.toHaveBeenCalled();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: getCompositionMixdownAudioElementResourceId('denied-comp-audio') }),
      ]));
  });
});

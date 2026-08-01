import { describe, expect, it } from 'vitest';
import type { Keyframe, Layer, TimelineClip, TimelineTrack } from '../../src/types';
import {
  assertHistoryTimelineEditStateSerializable,
  createHistoryTimelineEditState,
  findHistoryStateBoundaryViolations,
  toHistoryTimelineClipEditState,
} from '../../src/stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../src/stores/timeline/historyTimelineRestoreState';
import { cloneDefaultCaptionProperties } from '../../src/services/captions/captionDefaults';
import type { HistoryRuntimeRehydrationAdapter } from '../../src/stores/timeline/historyTimelineContracts';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import { createLegacyReplicatorContractFixture } from '../../src/services/motionDesign/replicator/contractFixtures';

function makeTransform(): TimelineClip['transform'] {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function makeTrack(): TimelineTrack {
  return {
    id: 'track-v1',
    name: 'Video 1',
    type: 'video',
    height: 64,
    muted: false,
    visible: true,
    solo: false,
  };
}

function makeRuntimeClip(): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'track-v1',
    name: 'Runtime Clip',
    file: { name: 'runtime.mp4' } as File,
    startTime: 3,
    duration: 7,
    inPoint: 1,
    outPoint: 8,
    source: {
      type: 'video',
      mediaFileId: 'media-1',
      naturalDuration: 12,
      file: { name: 'source-file.mp4' } as File,
      videoElement: { tagName: 'VIDEO' } as HTMLVideoElement,
      webCodecsPlayer: { currentTime: 1 } as TimelineClip['source'] extends infer Source
        ? Source extends { webCodecsPlayer?: infer Player }
          ? Player
          : never
        : never,
      runtimeSessionKey: 'runtime-session-1',
    },
    thumbnails: ['data:image/png;base64,thumb'],
    mediaFileId: 'media-1',
    linkedClipId: 'clip-a1',
    nestedClips: [
      {
        id: 'nested-runtime',
        trackId: 'nested-track',
        name: 'Nested Runtime',
        file: { name: 'nested.mp4' } as File,
        startTime: 0,
        duration: 1,
        inPoint: 0,
        outPoint: 1,
        source: {
          type: 'video',
          videoElement: { tagName: 'VIDEO' } as HTMLVideoElement,
        },
        transform: makeTransform(),
        effects: [],
      } as TimelineClip,
    ],
    mixdownAudio: { tagName: 'AUDIO' } as HTMLAudioElement,
    mixdownBuffer: { duration: 2 } as AudioBuffer,
    audioAnalysisJob: {
      clipId: 'clip-1',
      status: 'processing',
      progress: 50,
      startedAt: 100,
    },
    transform: makeTransform(),
    effects: [],
    masks: [],
    isLoading: false,
  } as TimelineClip;
}

function makeLayer(): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    sourceClipId: 'clip-1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'video',
      mediaFileId: 'media-1',
      file: { name: 'layer-source.mp4' } as File,
      videoElement: { tagName: 'VIDEO' } as HTMLVideoElement,
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
  };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    value.forEach((child) => collectKeys(child, keys));
    return keys;
  }

  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

describe('HistoryTimelineEditState contracts', () => {
  it('normalizes legacy Replicators before they enter undo history', () => {
    const clip = makeRuntimeClip();
    clip.source = { type: 'motion-shape', naturalDuration: clip.duration };
    clip.motion = createDefaultMotionLayerDefinition('shape');
    clip.motion.replicator = createLegacyReplicatorContractFixture() as unknown as
      NonNullable<TimelineClip['motion']>['replicator'];

    const editState = toHistoryTimelineClipEditState(clip);

    expect(editState.motion?.replicator).toMatchObject({
      contract: 'masterselects.motion-replicator',
      version: 2,
      enabled: true,
      layout: { mode: 'grid', count: { columns: 3, rows: 2 } },
    });
  });

  it('creates undo timeline state as JSON-serializable plain data', () => {
    const keyframes: Keyframe[] = [
      {
        id: 'kf-1',
        clipId: 'clip-1',
        property: 'opacity',
        time: 4,
        value: 0.5,
        easing: 'linear',
      },
    ];

    const state = createHistoryTimelineEditState({
      id: 'history-state-1',
      label: 'Move clip',
      timestamp: 12345,
      duration: 6,
      durationLocked: true,
      tracks: [makeTrack()],
      clips: [makeRuntimeClip()],
      selectedClipIds: new Set(['clip-1']),
      zoom: 50,
      scrollX: 10,
      layers: [makeLayer()],
      selectedLayerId: 'layer-1',
      clipKeyframes: new Map([['clip-1', keyframes]]),
      markers: [{ id: 'marker-1', time: 4, label: 'Cut', color: '#ffcc00' }],
    });

    expect(findHistoryStateBoundaryViolations(state)).toEqual([]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state.kind).toBe('history-timeline-edit-state');
    expect(state.timeline.duration).toBe(6);
    expect(state.timeline.durationLocked).toBe(true);
    expect(state.timeline.clips[0].runtimeRef).toEqual({
      kind: 'media-file',
      sourceType: 'video',
      mediaFileId: 'media-1',
      naturalDuration: 12,
    });
    expect(state.timeline.layers[0].sourceRef).toEqual({
      type: 'video',
      sourceClipId: 'clip-1',
      mediaFileId: 'media-1',
    });
  });

  it('excludes runtime-bearing TimelineClip and Layer source objects from undo state', () => {
    const clipEditState = toHistoryTimelineClipEditState(makeRuntimeClip());
    const keys = collectKeys(clipEditState);

    expect(keys.has('source')).toBe(false);
    expect(keys.has('file')).toBe(false);
    expect(keys.has('videoElement')).toBe(false);
    expect(keys.has('audioElement')).toBe(false);
    expect(keys.has('imageElement')).toBe(false);
    expect(keys.has('webCodecsPlayer')).toBe(false);
    expect(keys.has('nativeDecoder')).toBe(false);
    expect(keys.has('textCanvas')).toBe(false);
    expect(keys.has('mixdownAudio')).toBe(false);
    expect(keys.has('mixdownBuffer')).toBe(false);
    expect(keys.has('nestedClips')).toBe(false);
    expect(keys.has('nestedTracks')).toBe(false);
  });

  it('restores composition duration and preserves it for legacy entries that omit the fields', () => {
    const history = createHistoryTimelineEditState({
      id: 'duration-history',
      label: 'Edit six-second composition',
      timestamp: 12347,
      duration: 6,
      durationLocked: true,
      tracks: [makeTrack()],
      clips: [],
      selectedClipIds: [],
      zoom: 50,
      scrollX: 0,
    });

    const restored = createHistoryTimelineRestoreState(history, {
      duration: 60,
      durationLocked: false,
    });
    expect(restored.state.duration).toBe(6);
    expect(restored.state.durationLocked).toBe(true);

    delete history.timeline.duration;
    delete history.timeline.durationLocked;
    const legacy = createHistoryTimelineRestoreState(history, {
      duration: 12,
      durationLocked: false,
    });
    expect(legacy.state.duration).toBe(12);
    expect(legacy.state.durationLocked).toBe(false);
  });

  it('round-trips caption styling through undo history', () => {
    const clip = makeRuntimeClip();
    clip.captionProperties = {
      ...cloneDefaultCaptionProperties(),
      fontSize: 72,
      highlight: {
        ...cloneDefaultCaptionProperties().highlight,
        mode: 'spoken-words',
      },
    };
    clip.captionLayerBinding = {
      schemaVersion: 1,
      role: 'text',
      inputClipId: 'caption-input',
    };
    const history = createHistoryTimelineEditState({
      id: 'caption-history',
      label: 'Update captions',
      timestamp: 12346,
      tracks: [makeTrack()],
      clips: [clip],
      selectedClipIds: new Set([clip.id]),
      zoom: 50,
      scrollX: 0,
    });

    clip.captionProperties.fontSize = 99;
    clip.captionLayerBinding.inputClipId = 'changed-input';
    const restored = createHistoryTimelineRestoreState(history, { clips: [clip] });

    expect(restored.state.clips[0].captionProperties).toEqual({
      ...cloneDefaultCaptionProperties(),
      fontSize: 72,
      highlight: {
        ...cloneDefaultCaptionProperties().highlight,
        mode: 'spoken-words',
      },
    });
    expect(restored.state.clips[0].captionProperties).not.toBe(clip.captionProperties);
    expect(restored.state.clips[0].captionLayerBinding).toEqual({
      schemaVersion: 1,
      role: 'text',
      inputClipId: 'caption-input',
    });
    expect(restored.state.clips[0].captionLayerBinding).not.toBe(clip.captionLayerBinding);
  });

  it('rejects manual history state objects with runtime payload keys', () => {
    const invalidState = {
      kind: 'history-timeline-edit-state',
      schemaVersion: 1,
      id: 'bad-state',
      label: 'Bad',
      timestamp: 1,
      timeline: {
        tracks: [],
        clips: [
          {
            id: 'clip-1',
            source: { videoElement: { tagName: 'VIDEO' } },
          },
        ],
        selectedClipIds: [],
        zoom: 1,
        scrollX: 0,
        layers: [],
        selectedLayerId: null,
        clipKeyframes: {},
        markers: [],
      },
    };

    expect(() => assertHistoryTimelineEditStateSerializable(invalidState)).toThrow(
      /runtime payload key/
    );
  });

  it('allows shared plain edit data while rejecting actual cycles', () => {
    const sharedMarker = { id: 'marker-shared', time: 2, label: 'Shared' };
    const repeatedPlainData = {
      first: sharedMarker,
      second: sharedMarker,
    };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    expect(findHistoryStateBoundaryViolations(repeatedPlainData)).toEqual([]);
    expect(findHistoryStateBoundaryViolations(cycle)).toEqual([
      '$.self: circular reference',
    ]);
  });

  it('types runtime rehydration as an adapter around history edit state', async () => {
    const state = createHistoryTimelineEditState({
      id: 'history-state-2',
      label: 'Undo',
      timestamp: 100,
      tracks: [makeTrack()],
      clips: [makeRuntimeClip()],
      selectedClipIds: [],
      zoom: 50,
      scrollX: 0,
    });

    const adapter: HistoryRuntimeRehydrationAdapter = {
      async rehydrateTimelineEditState(request) {
        return {
          status: 'deferred',
          hydratedClipIds: [],
          deferredClipIds: request.state.timeline.clips.map((clip) => clip.id),
          runtimeRefs: request.state.timeline.clips.map((clip) => clip.runtimeRef),
          diagnostics: {
            resourceCount: request.state.timeline.clips.length,
            deferredCount: request.state.timeline.clips.length,
            failedCount: 0,
          },
        };
      },
    };

    const result = await adapter.rehydrateTimelineEditState({
      state,
      reason: 'undo',
      policy: 'interactive',
      scope: { playheadPosition: 3 },
    });

    expect(result.status).toBe('deferred');
    expect(result.deferredClipIds).toEqual(['clip-1']);
    expect(result.runtimeRefs[0].kind).toBe('media-file');
  });
});

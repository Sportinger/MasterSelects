import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initHistoryStoreRefs,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TRACKS } from '../../src/stores/timeline/constants';
import {
  addClipCustomNodeDefinition,
  clearAINodeRuntimeCache,
  createClipAICustomNodeDefinition,
  renderClipAINodesToCanvas,
} from '../../src/services/nodeGraph';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import {
  createResolvedClipMoveOperationPlan,
  resolveClipMoveRequest,
} from '../../src/stores/timeline/editOperations/moveResolution';
import { createMaskPathProperty, type LayerSource, type TimelineClip } from '../../src/types';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';

function createTransitionJunctionFixture(clipAId = 'clip-a', clipBId = 'clip-b', junctionTime = 10) {
  return {
    geometrySnapshotId: 'geometry-1',
    trackId: 'video-1',
    clipAId,
    clipBId,
    junctionTime,
    junctionRect: { geometrySnapshotId: 'geometry-1', rectId: 'junction', kind: 'transition-junction' },
    dropZoneRect: { geometrySnapshotId: 'geometry-1', rectId: 'drop-zone', kind: 'transition-drop-zone' },
    thresholdSeconds: 0.5,
  } as const;
}

function createSourceCanvas(width = 2, height = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context?.createImageData(width, height);
  if (image) {
    image.data.fill(255);
    context?.putImageData(image, 0, 0);
  }
  return canvas;
}

function createIdentityAINodeClip(id: string): TimelineClip {
  const clip = createMockClip({ id, trackId: 'video-1', source: { type: 'text' } });
  const definition = {
    ...createClipAICustomNodeDefinition('custom-ai', clip),
    status: 'ready' as const,
    ai: {
      prompt: 'Pass input through',
      generatedCode: 'defineNode({ process(input) { return { output: input.input }; } })',
    },
  };
  return {
    ...clip,
    nodeGraph: addClipCustomNodeDefinition(clip, definition),
  };
}

function initializeTestHistoryRefs() {
  initHistoryStoreRefs({
    timeline: {
      getState: () => useTimelineStore.getState(),
      setState: (state) => useTimelineStore.setState(state),
    },
    media: {
      getState: () => ({
        files: [],
        compositions: [],
        folders: [],
        selectedIds: [],
        expandedFolderIds: [],
        textItems: [],
        solidItems: [],
        mathSceneItems: [],
        motionShapeItems: [],
        signalAssets: [],
        signalArtifacts: [],
        signalGraphs: [],
        signalOperators: [],
      }),
      setState: vi.fn(),
    },
    dock: {
      getState: () => ({ layout: null as never }),
      setState: vi.fn(),
    },
  });
}

describe('timeline edit operations kernel', () => {
  beforeEach(() => {
    initializeTestHistoryRefs();
    useHistoryStore.getState().clearHistory();
    clearAINodeRuntimeCache();
    timelineRuntimeCoordinator.clearResources();
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS,
      clips: [],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      playheadPosition: 0,
      isExporting: false,
      duration: 60,
      timelineToolPreview: null,
    });
  });

  afterEach(() => {
    useHistoryStore.getState().clearHistory();
    clearAINodeRuntimeCache();
    timelineRuntimeCoordinator.clearResources();
  });

  it('blocks mutating operations while export is active', () => {
    useTimelineStore.setState({
      isExporting: true,
      clips: [createMockClip({ id: 'clip-1', startTime: 0, duration: 10, outPoint: 10 })],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'split-export-test',
      type: 'split-at-time',
      clipIds: ['clip-1'],
      time: 5,
    }, { source: 'ui' });

    expect(result.success).toBe(false);
    expect(result.warnings[0]?.code).toBe('export-locked');
    expect(useTimelineStore.getState().clips).toHaveLength(1);
  });

  it('routes split at playhead through one operation result and avoids linked duplicates', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
      selectedClipIds: new Set(['video-1', 'audio-1']),
      playheadPosition: 4,
    });

    useTimelineStore.getState().splitClipAtPlayhead();

    const clips = useTimelineStore.getState().clips;
    expect(clips).toHaveLength(4);
    expect(clips.filter((clip) => clip.trackId === 'video-1')).toHaveLength(2);
    expect(clips.filter((clip) => clip.trackId === 'audio-1')).toHaveLength(2);
  });

  it('bulk splits one linked clip through the operation kernel', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'bulk-split',
      type: 'split-at-times',
      clipId: 'video-1',
      times: [4, 8],
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: split clip at times' });

    const clips = useTimelineStore.getState().clips;
    expect(result.success).toBe(true);
    expect(clips.filter((clip) => clip.trackId === 'video-1')).toHaveLength(3);
    expect(clips.filter((clip) => clip.trackId === 'audio-1')).toHaveLength(3);
    expect(clips.filter((clip) => clip.trackId === 'video-1').map((clip) => [clip.startTime, clip.duration])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
    ]);
    expect([...useTimelineStore.getState().selectedClipIds]).toHaveLength(1);
  });

  it('bulk splits media runtime sources as data-only parts', () => {
    const video = createMockClip({
      id: 'video-runtime',
      trackId: 'video-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'audio-runtime',
      mediaFileId: 'media-video',
      source: {
        type: 'video',
        videoElement: document.createElement('video'),
        webCodecsPlayer: { destroy: vi.fn() } as never,
        nativeDecoder: { close: vi.fn() } as never,
        naturalDuration: 12,
        mediaFileId: 'media-video',
        runtimeSourceId: 'runtime-video',
        runtimeSessionKey: 'interactive:video-runtime',
        filePath: 'C:/media/video.mp4',
      },
    });
    const audio = createMockClip({
      id: 'audio-runtime',
      trackId: 'audio-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'video-runtime',
      mediaFileId: 'media-audio',
      source: {
        type: 'audio',
        audioElement: document.createElement('audio'),
        naturalDuration: 12,
        mediaFileId: 'media-audio',
        runtimeSourceId: 'runtime-audio',
        runtimeSessionKey: 'interactive:audio-runtime',
        filePath: 'C:/media/audio.wav',
      },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'bulk-runtime-data-only-split',
      type: 'split-at-times',
      clipId: 'video-runtime',
      times: [4, 8],
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Split runtime-backed clip' });

    expect(result.success).toBe(true);
    const clips = useTimelineStore.getState().clips;
    const videoParts = clips.filter((clip) => clip.trackId === 'video-1');
    const audioParts = clips.filter((clip) => clip.trackId === 'audio-1');

    expect(videoParts).toHaveLength(3);
    expect(audioParts).toHaveLength(3);
    expect(videoParts.every((clip) =>
      !clip.source?.videoElement &&
      !clip.source?.webCodecsPlayer &&
      !clip.source?.nativeDecoder &&
      !clip.source?.runtimeSourceId &&
      !clip.source?.runtimeSessionKey
    )).toBe(true);
    expect(audioParts.every((clip) =>
      !clip.source?.audioElement &&
      !clip.source?.runtimeSourceId &&
      !clip.source?.runtimeSessionKey
    )).toBe(true);
    expect(videoParts.map((clip) => clip.source)).toEqual([
      {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-video',
        filePath: 'C:/media/video.mp4',
      },
      {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-video',
        filePath: 'C:/media/video.mp4',
      },
      {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-video',
        filePath: 'C:/media/video.mp4',
      },
    ]);
  });

  it('bulk splits linked composition audio as data-only parts', () => {
    const staleAudioElement = { src: 'blob:stale-mixdown' } as unknown as HTMLAudioElement;
    const mixdownBuffer = { duration: 12 } as AudioBuffer;
    const video = createMockClip({
      id: 'comp-video',
      trackId: 'video-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'comp-audio',
      isComposition: true,
      compositionId: 'comp-1',
      source: { type: 'video', naturalDuration: 12 },
    });
    const audio = createMockClip({
      id: 'comp-audio',
      trackId: 'audio-1',
      startTime: 0,
      duration: 12,
      inPoint: 0,
      outPoint: 12,
      linkedClipId: 'comp-video',
      isComposition: true,
      compositionId: 'comp-1',
      source: {
        type: 'audio',
        audioElement: staleAudioElement,
        naturalDuration: 12,
      },
      mixdownBuffer,
      hasMixdownAudio: true,
    });
    const createElementSpy = vi.spyOn(document, 'createElement');
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'bulk-composition-audio-split',
      type: 'split-at-times',
      clipId: 'comp-video',
      times: [4, 8],
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Split composition audio' });

    const audioParts = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === 'audio-1')
      .toSorted((a, b) => a.startTime - b.startTime);
    expect(result.success).toBe(true);
    expect(createElementSpy).not.toHaveBeenCalledWith('audio');
    expect(audioParts).toHaveLength(3);
    expect(audioParts.map((clip) => clip.source)).toEqual([
      { type: 'audio', naturalDuration: 12 },
      { type: 'audio', naturalDuration: 12 },
      { type: 'audio', naturalDuration: 12 },
    ]);
    expect(audioParts.map((clip) => clip.mixdownBuffer)).toEqual([mixdownBuffer, mixdownBuffer, mixdownBuffer]);
  });

  it('splits only the requested audio clip and clears the stale video link', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'split-audio-only',
      type: 'split-at-times',
      clipId: 'audio-1',
      times: [3, 7],
      includeLinked: false,
    }, { source: 'ui', historyLabel: 'Split audio region' });

    const clips = useTimelineStore.getState().clips;
    expect(result.success).toBe(true);
    expect(clips.filter((clip) => clip.trackId === 'video-1')).toHaveLength(1);
    expect(clips.find((clip) => clip.id === 'video-1')?.linkedClipId).toBeUndefined();
    expect(clips.filter((clip) => clip.trackId === 'audio-1').map((clip) => [clip.startTime, clip.duration])).toEqual([
      [0, 3],
      [3, 4],
      [7, 3],
    ]);
  });

  it('selects clips from time across unlocked visible tracks', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'video-2', type: 'video', locked: true }),
      ],
      clips: [
        createMockClip({ id: 'before', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'after', trackId: 'video-1', startTime: 5, duration: 2 }),
        createMockClip({ id: 'locked', trackId: 'video-2', startTime: 5, duration: 2 }),
      ],
    });

    const result = useTimelineStore.getState().selectClipsFromTime(3);

    expect(result.success).toBe(true);
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['after']);
  });

  it('ripple deletes selected clips on their tracks', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 2, duration: 2 }),
        createMockClip({ id: 'c', trackId: 'video-1', startTime: 4, duration: 2 }),
      ],
      selectedClipIds: new Set(['b']),
    });

    const result = useTimelineStore.getState().rippleDeleteSelection();

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['a', 0],
      ['c', 2],
    ]);
  });

  it('deletes linked clips without relying on selection side effects', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 4,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
      selectedClipIds: new Set(),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'delete-linked',
      type: 'delete-clips',
      clipIds: ['video-1'],
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: delete clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips).toEqual([]);
  });

  it('releases AI node runtime resources for clips deleted by the edit kernel', () => {
    const clip = createIdentityAINodeClip('ai-node-delete');
    const source: LayerSource = {
      type: 'text',
      textCanvas: createSourceCanvas(4, 2),
    };
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [clip],
      selectedClipIds: new Set(),
    });

    expect(renderClipAINodesToCanvas(clip, source, 'layer-ai-node-delete', 0)).not.toBeNull();
    expect(timelineRuntimeCoordinator
      .getBridgeStats()
      .policies.interactive.resources
      .filter((resource) => resource.tags?.includes('ai-node-runtime'))).toHaveLength(2);

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'delete-ai-runtime',
      type: 'delete-clips',
      clipIds: [clip.id],
    }, { source: 'ui' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips).toEqual([]);
    expect(timelineRuntimeCoordinator
      .getBridgeStats()
      .policies.interactive.resources
      .filter((resource) => resource.tags?.includes('ai-node-runtime'))).toHaveLength(0);
  });

  it('applies keyboard delete command keyframes-first without deleting selected clips', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    const keyframes = [
      createMockKeyframe({ id: 'kf-delete', clipId: 'clip-1', property: 'opacity', time: 0, value: 0.5 }),
      createMockKeyframe({ id: 'kf-keep', clipId: 'clip-1', property: 'opacity', time: 1, value: 1 }),
    ];
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [clip],
      clipKeyframes: new Map([['clip-1', keyframes]]),
      selectedClipIds: new Set(['clip-1']),
      selectedKeyframeIds: new Set(['kf-delete']),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'keyboard-delete',
      type: 'keyboard-delete-command',
      transactionId: 'keyboard-delete',
      historyBatchId: 'keyboard-delete',
      source: 'shortcut',
      command: 'delete',
      priority: 'keyframes-first',
      keyframeIds: ['kf-delete'],
      clipIds: ['clip-1'],
      includeLinked: false,
    }, { source: 'shortcut', historyLabel: 'Delete keyframes' });

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['clip-1']);
    expect(useTimelineStore.getState().clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
    expect(useTimelineStore.getState().clipKeyframes.get('clip-1')?.map((keyframe) => keyframe.id)).toEqual(['kf-keep']);
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['clip-1']);
    expect([...useTimelineStore.getState().selectedKeyframeIds]).toEqual([]);
  });

  it('warns for missing and locked keyframes in keyboard delete command while deleting valid keyframes', () => {
    const unlocked = createMockClip({ id: 'unlocked-clip', trackId: 'video-1' });
    const locked = createMockClip({ id: 'locked-clip', trackId: 'video-2' });
    const keyframes = new Map([
      [
        'unlocked-clip',
        [
          createMockKeyframe({ id: 'kf-valid', clipId: 'unlocked-clip', property: 'opacity', time: 0, value: 0.5 }),
        ],
      ],
      [
        'locked-clip',
        [
          createMockKeyframe({ id: 'kf-locked', clipId: 'locked-clip', property: 'opacity', time: 0, value: 0.5 }),
        ],
      ],
    ]);
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'video-2', type: 'video', locked: true }),
      ],
      clips: [unlocked, locked],
      clipKeyframes: keyframes,
      selectedKeyframeIds: new Set(['kf-valid', 'kf-locked', 'kf-missing']),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'keyboard-delete-keyframes-mixed',
      type: 'keyboard-delete-command',
      transactionId: 'keyboard-delete-keyframes-mixed',
      historyBatchId: 'keyboard-delete-keyframes-mixed',
      source: 'shortcut',
      command: 'delete',
      priority: 'keyframes-first',
      keyframeIds: ['kf-valid', 'kf-locked', 'kf-missing'],
      clipIds: [],
      includeLinked: false,
    }, { source: 'shortcut', historyLabel: 'Delete keyframes' });

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['unlocked-clip']);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['track-locked', 'keyframe-not-found']);
    expect(useTimelineStore.getState().clipKeyframes.has('unlocked-clip')).toBe(false);
    expect(useTimelineStore.getState().clipKeyframes.get('locked-clip')?.map((keyframe) => keyframe.id)).toEqual(['kf-locked']);
  });

  it('applies keyboard delete command clips-only with selected-linked parity', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
      selectedClipIds: new Set(['video-1']),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'keyboard-delete-clips',
      type: 'keyboard-delete-command',
      transactionId: 'keyboard-delete-clips',
      historyBatchId: 'keyboard-delete-clips',
      source: 'shortcut',
      command: 'delete',
      priority: 'clips-only',
      keyframeIds: [],
      clipIds: ['video-1'],
      includeLinked: false,
    }, { source: 'shortcut', historyLabel: 'Delete clips' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((candidate) => [candidate.id, candidate.linkedClipId])).toEqual([
      ['audio-1', undefined],
    ]);
  });

  it('applies keyboard blend-mode command to all requested unlocked clips', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'clip-a', trackId: 'video-1' }),
        createMockClip({ id: 'clip-b', trackId: 'video-1' }),
      ],
      selectedClipIds: new Set(['clip-a', 'clip-b']),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'keyboard-blend',
      type: 'keyboard-cycle-blend-mode-command',
      transactionId: 'keyboard-blend',
      historyBatchId: 'keyboard-blend',
      source: 'shortcut',
      command: 'cycle-blend-mode',
      clipIds: ['clip-a', 'clip-b'],
      direction: 'next',
      anchorClipId: 'clip-a',
      currentBlendMode: 'normal',
      nextBlendMode: 'dissolve',
      blendModeSequence: ['normal', 'dissolve'],
    }, { source: 'shortcut', historyLabel: 'Cycle blend mode' });

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['clip-a', 'clip-b']);
    expect(useTimelineStore.getState().clips.map((candidate) => [candidate.id, candidate.transform.blendMode])).toEqual([
      ['clip-a', 'dissolve'],
      ['clip-b', 'dissolve'],
    ]);
  });

  it('applies keyframe transaction commit operations through the kernel', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', duration: 10 });
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [clip],
      clipKeyframes: new Map([['clip-1', [
        createMockKeyframe({ id: 'kf-move', clipId: 'clip-1', property: 'opacity', time: 1, value: 0.25 }),
        createMockKeyframe({ id: 'kf-update', clipId: 'clip-1', property: 'opacity', time: 2, value: 0.5 }),
        createMockKeyframe({ id: 'kf-remove', clipId: 'clip-1', property: 'opacity', time: 4, value: 1 }),
      ]]]),
      selectedKeyframeIds: new Set(),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'keyframe-commit',
      type: 'keyframe-transaction-commit',
      transactionId: 'keyframe-commit',
      historyBatchId: 'keyframe-commit',
      source: 'ui',
      phase: 'commit',
      clipId: 'clip-1',
      property: 'opacity',
      keyframeIds: ['kf-move', 'kf-update', 'kf-remove'],
      operations: [
        {
          type: 'keyframe-move',
          keyframeId: 'kf-move',
          clipId: 'clip-1',
          property: 'opacity',
          originalTime: 1,
          requestedTime: 3,
          resolvedTime: 3,
        },
        {
          type: 'keyframe-update-value',
          keyframeId: 'kf-update',
          clipId: 'clip-1',
          property: 'opacity',
          value: { value: 0.75 },
        },
        {
          type: 'keyframe-update-easing',
          keyframeId: 'kf-update',
          clipId: 'clip-1',
          property: 'opacity',
          easing: 'ease-in',
        },
        {
          type: 'keyframe-remove',
          keyframeId: 'kf-remove',
          clipId: 'clip-1',
          property: 'opacity',
        },
        {
          type: 'keyframe-create',
          clipId: 'clip-1',
          property: 'opacity',
          time: 5,
          value: { value: 0.2 },
          easing: 'linear',
        },
        {
          type: 'keyframe-select',
          selectedKeyframeIds: ['kf-update'],
          mode: 'replace',
        },
      ],
    }, { source: 'ui', historyLabel: 'Commit keyframe transaction' });

    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [];

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['clip-1']);
    expect(result.warnings).toEqual([]);
    expect(keyframes.find(keyframe => keyframe.id === 'kf-move')?.time).toBe(3);
    expect(keyframes.find(keyframe => keyframe.id === 'kf-update')).toMatchObject({
      value: 0.75,
      easing: 'ease-in',
    });
    expect(keyframes.some(keyframe => keyframe.id === 'kf-remove')).toBe(false);
    expect(keyframes).toEqual(expect.arrayContaining([
      expect.objectContaining({ clipId: 'clip-1', property: 'opacity', time: 5, value: 0.2 }),
    ]));
    expect([...useTimelineStore.getState().selectedKeyframeIds]).toEqual(['kf-update']);
  });

  it('creates and updates path-value keyframes through the keyframe transaction kernel', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', duration: 10 });
    const property = createMaskPathProperty('mask-1');
    const pathValue = {
      closed: true,
      vertices: [
        {
          id: 'v1',
          x: 0.1,
          y: 0.2,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
        },
      ],
    };
    const replacementPathValue = {
      closed: false,
      vertices: [
        {
          id: 'v2',
          x: 0.4,
          y: 0.5,
          handleIn: { x: 0.1, y: 0 },
          handleOut: { x: -0.1, y: 0 },
        },
      ],
    };

    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [clip],
      clipKeyframes: new Map([['clip-1', [
        createMockKeyframe({
          id: 'kf-existing-path',
          clipId: 'clip-1',
          property,
          time: 2,
          value: 0,
          pathValue,
        }),
      ]]]),
      selectedKeyframeIds: new Set(),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'path-keyframe-commit',
      type: 'keyframe-transaction-commit',
      transactionId: 'path-keyframe-commit',
      historyBatchId: 'path-keyframe-commit',
      source: 'ui',
      phase: 'commit',
      clipId: 'clip-1',
      property,
      keyframeIds: [],
      operations: [
        {
          type: 'keyframe-create',
          clipId: 'clip-1',
          property,
          time: 1,
          value: { pathValue },
          easing: 'linear',
        },
        {
          type: 'keyframe-create',
          clipId: 'clip-1',
          property,
          time: 2,
          value: { pathValue: replacementPathValue },
          easing: 'ease-in',
        },
      ],
    }, { source: 'ui', historyLabel: 'Commit path keyframes' });

    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [];
    const created = keyframes.find(keyframe => keyframe.time === 1);
    const updated = keyframes.find(keyframe => keyframe.id === 'kf-existing-path');

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['clip-1']);
    expect(result.warnings).toEqual([]);
    expect(keyframes).toHaveLength(2);
    expect(created).toMatchObject({
      clipId: 'clip-1',
      property,
      value: 0,
      pathValue,
      easing: 'linear',
    });
    expect(created?.pathValue).not.toBe(pathValue);
    expect(updated).toMatchObject({
      value: 0,
      pathValue: replacementPathValue,
      easing: 'ease-in',
    });
    expect(updated?.pathValue).not.toBe(replacementPathValue);
  });

  it('warns for missing and locked keyframe transaction operations while applying valid ones', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'video-2', type: 'video', locked: true }),
      ],
      clips: [
        createMockClip({ id: 'clip-valid', trackId: 'video-1', duration: 10 }),
        createMockClip({ id: 'clip-locked', trackId: 'video-2', duration: 10 }),
      ],
      clipKeyframes: new Map([
        ['clip-valid', [
          createMockKeyframe({ id: 'kf-valid', clipId: 'clip-valid', property: 'opacity', time: 1, value: 0.2 }),
        ]],
        ['clip-locked', [
          createMockKeyframe({ id: 'kf-locked', clipId: 'clip-locked', property: 'opacity', time: 1, value: 0.2 }),
        ]],
      ]),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'keyframe-mixed',
      type: 'keyframe-transaction-update',
      transactionId: 'keyframe-mixed',
      historyBatchId: 'keyframe-mixed',
      source: 'ui',
      phase: 'update',
      clipId: 'clip-valid',
      property: 'opacity',
      keyframeIds: ['kf-valid', 'kf-locked', 'kf-missing'],
      operations: [
        {
          type: 'keyframe-move',
          keyframeId: 'kf-valid',
          clipId: 'clip-valid',
          property: 'opacity',
          originalTime: 1,
          requestedTime: 2,
          resolvedTime: 2,
        },
        {
          type: 'keyframe-move',
          keyframeId: 'kf-locked',
          clipId: 'clip-locked',
          property: 'opacity',
          originalTime: 1,
          requestedTime: 2,
          resolvedTime: 2,
        },
        {
          type: 'keyframe-remove',
          keyframeId: 'kf-missing',
          clipId: 'clip-valid',
          property: 'opacity',
        },
      ],
    }, { source: 'ui', historyLabel: 'Update keyframe transaction' });

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['clip-valid']);
    expect(result.warnings.map(warning => warning.code)).toEqual(['track-locked', 'keyframe-not-found']);
    expect(useTimelineStore.getState().clipKeyframes.get('clip-valid')?.[0]?.time).toBe(2);
    expect(useTimelineStore.getState().clipKeyframes.get('clip-locked')?.[0]?.time).toBe(1);
  });

  it('applies fade transaction commit by materializing left fade keyframes', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [createMockClip({ id: 'clip-1', trackId: 'video-1', duration: 10 })],
      clipKeyframes: new Map(),
    });

    const beginResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'fade-begin',
      type: 'fade-transaction-begin',
      transactionId: 'fade-begin',
      historyBatchId: 'fade-begin',
      source: 'ui',
      phase: 'begin',
      clipId: 'clip-1',
      edge: 'left',
      originalFadeDuration: 0,
      clipDuration: 10,
      property: 'opacity',
    }, { source: 'ui', historyLabel: 'Begin fade transaction' });

    const commitResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'fade-commit',
      type: 'fade-transaction-commit',
      transactionId: 'fade-commit',
      historyBatchId: 'fade-commit',
      source: 'ui',
      phase: 'commit',
      clipId: 'clip-1',
      edge: 'left',
      finalFadeDuration: 2,
      keyframePlan: {
        clipId: 'clip-1',
        property: 'opacity',
        edge: 'left',
        duration: 2,
        zeroKeyframeId: 'fade-zero',
        oneKeyframeId: 'fade-one',
        createdKeyframeIds: ['fade-zero', 'fade-one'],
        movedKeyframeIds: [],
        removedKeyframeIds: [],
      },
    }, { source: 'ui', historyLabel: 'Commit fade transaction' });
    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [];

    expect(beginResult.success).toBe(true);
    expect(beginResult.warnings).toEqual([]);
    expect(commitResult.success).toBe(true);
    expect(commitResult.changedClipIds).toEqual(['clip-1']);
    expect(keyframes).toEqual([
      expect.objectContaining({ id: 'fade-zero', clipId: 'clip-1', property: 'opacity', time: 0, value: 0, easing: 'ease-out' }),
      expect.objectContaining({ id: 'fade-one', clipId: 'clip-1', property: 'opacity', time: 2, value: 1, easing: 'linear' }),
    ]);
  });

  it('updates existing right fade keyframes while preserving curve handles', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [createMockClip({ id: 'clip-1', trackId: 'video-1', duration: 10 })],
      clipKeyframes: new Map([['clip-1', [
        createMockKeyframe({
          id: 'fade-one',
          clipId: 'clip-1',
          property: 'opacity',
          time: 8,
          value: 1,
          easing: 'bezier',
          handleOut: { x: 0.2, y: 0.5 },
        }),
        createMockKeyframe({
          id: 'fade-zero',
          clipId: 'clip-1',
          property: 'opacity',
          time: 10,
          value: 0,
          easing: 'linear',
        }),
      ]]]),
      selectedKeyframeIds: new Set(['fade-one', 'fade-zero']),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'fade-update-right',
      type: 'fade-transaction-update',
      transactionId: 'fade-update-right',
      historyBatchId: 'fade-update-right',
      source: 'ui',
      phase: 'update',
      clipId: 'clip-1',
      edge: 'right',
      requestedFadeDuration: 3,
      resolvedFadeDuration: 3,
      keyframePlan: {
        clipId: 'clip-1',
        property: 'opacity',
        edge: 'right',
        duration: 3,
        zeroKeyframeId: 'fade-zero',
        oneKeyframeId: 'fade-one',
        createdKeyframeIds: [],
        movedKeyframeIds: ['fade-one'],
        removedKeyframeIds: [],
      },
    }, { source: 'ui', historyLabel: 'Update fade transaction' });
    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [];

    expect(result.success).toBe(true);
    expect(keyframes.find(keyframe => keyframe.id === 'fade-one')).toMatchObject({
      time: 7,
      value: 1,
      easing: 'bezier',
      handleOut: { x: 0.2, y: 0.5 },
    });
    expect(keyframes.find(keyframe => keyframe.id === 'fade-zero')).toMatchObject({
      time: 10,
      value: 0,
    });
    expect([...useTimelineStore.getState().selectedKeyframeIds]).toEqual(['fade-one', 'fade-zero']);
  });

  it('removes fade keyframes when committed duration is zero', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [createMockClip({ id: 'clip-1', trackId: 'video-1', duration: 10 })],
      clipKeyframes: new Map([['clip-1', [
        createMockKeyframe({ id: 'fade-zero', clipId: 'clip-1', property: 'opacity', time: 0, value: 0 }),
        createMockKeyframe({ id: 'fade-one', clipId: 'clip-1', property: 'opacity', time: 2, value: 1 }),
      ]]]),
      selectedKeyframeIds: new Set(['fade-zero', 'fade-one']),
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'fade-remove-left',
      type: 'fade-transaction-commit',
      transactionId: 'fade-remove-left',
      historyBatchId: 'fade-remove-left',
      source: 'ui',
      phase: 'commit',
      clipId: 'clip-1',
      edge: 'left',
      finalFadeDuration: 0,
      keyframePlan: {
        clipId: 'clip-1',
        property: 'opacity',
        edge: 'left',
        duration: 0,
        zeroKeyframeId: 'fade-zero',
        oneKeyframeId: 'fade-one',
        createdKeyframeIds: [],
        movedKeyframeIds: [],
        removedKeyframeIds: ['fade-zero', 'fade-one'],
      },
    }, { source: 'ui', historyLabel: 'Remove fade transaction' });

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['clip-1']);
    expect(useTimelineStore.getState().clipKeyframes.has('clip-1')).toBe(false);
    expect([...useTimelineStore.getState().selectedKeyframeIds]).toEqual([]);
  });

  it('stores transition drop preview ghost ranges through the operation kernel', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          source: { type: 'video', naturalDuration: 12 },
        }),
        createMockClip({ id: 'clip-b', trackId: 'video-1', startTime: 10, duration: 8, inPoint: 0.5, outPoint: 8.5 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-preview',
      type: 'transition-preview-drop',
      transactionId: 'typed-transition-preview',
      historyBatchId: 'typed-transition-preview',
      source: 'external-drop',
      geometrySnapshotId: 'geometry-1',
      transitionType: 'crossfade',
      requestedDuration: 2,
      junction: createTransitionJunctionFixture('clip-a', 'clip-b', 10),
    }, { source: 'external-drop', historyLabel: 'Preview transition drop' });

    const preview = useTimelineStore.getState().timelineToolPreview;

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(preview).toMatchObject({
      toolId: 'select',
      plane: 'section-scrolled',
      trackId: 'video-1',
      time: 10,
      startTime: 9,
      endTime: 11,
      label: 'crossfade',
      zIndex: 16,
    });
    expect(preview?.ghostRanges).toEqual([
      {
        id: 'typed-transition-preview:transition-preview',
        trackId: 'video-1',
        startTime: 9,
        endTime: 11,
        label: 'crossfade',
        variant: 'transition-drop',
      },
      {
        id: 'typed-transition-preview:incoming:source-handle:9.5000:10.0000',
        trackId: 'video-1',
        startTime: 9.5,
        endTime: 10,
        label: '0.5s source',
        variant: 'transition-source-handle',
      },
      {
        id: 'typed-transition-preview:outgoing:source-handle:10.0000:12.0000',
        trackId: 'video-1',
        startTime: 10,
        endTime: 12,
        label: '2.0s source',
        variant: 'transition-source-handle',
      },
      {
        id: 'typed-transition-preview:incoming:hold:9.0000:9.5000',
        trackId: 'video-1',
        startTime: 9,
        endTime: 9.5,
        label: '+0.5s hold',
        variant: 'transition-hold-fallback',
      },
    ]);
  });

  it('stores and clears blocked transition drop preview state', () => {
    const previewResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-preview-blocked',
      type: 'transition-preview-drop',
      transactionId: 'typed-transition-preview-blocked',
      historyBatchId: 'typed-transition-preview-blocked',
      source: 'external-drop',
      geometrySnapshotId: 'geometry-1',
      transitionType: 'crossfade',
      requestedDuration: 1,
      junction: null,
    }, { source: 'external-drop', historyLabel: 'Preview transition drop' });

    expect(previewResult.success).toBe(true);
    expect(previewResult.changedClipIds).toEqual([]);
    expect(previewResult.warnings[0]?.code).toBe('invalid-range');
    expect(useTimelineStore.getState().timelineToolPreview).toMatchObject({
      toolId: 'select',
      plane: 'section-scrolled',
      label: 'crossfade',
      blocked: true,
      message: 'No transition junction at the current drop target.',
      zIndex: 16,
    });

    const clearResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-clear',
      type: 'transition-clear-preview',
      transactionId: 'typed-transition-clear',
      historyBatchId: 'typed-transition-clear',
      source: 'external-drop',
      reason: 'drag-leave',
    }, { source: 'external-drop', historyLabel: 'Clear transition preview' });

    expect(clearResult.success).toBe(true);
    expect(clearResult.changedClipIds).toEqual([]);
    expect(clearResult.warnings).toEqual([]);
    expect(useTimelineStore.getState().timelineToolPreview).toBeNull();
  });

  it('applies a typed transition operation with reciprocal clip metadata', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'clip-a', trackId: 'video-1', startTime: 0, duration: 10 }),
        createMockClip({ id: 'clip-b', trackId: 'video-1', startTime: 10, duration: 8 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-apply',
      type: 'transition-apply',
      transactionId: 'typed-transition-apply',
      historyBatchId: 'typed-transition-apply',
      source: 'external-drop',
      clipAId: 'clip-a',
      clipBId: 'clip-b',
      transitionType: 'crossfade',
      requestedDuration: 2,
      junction: createTransitionJunctionFixture(),
    }, { source: 'external-drop', historyLabel: 'Drop transition' });

    const clips = useTimelineStore.getState().clips;
    const clipA = clips.find(clip => clip.id === 'clip-a');
    const clipB = clips.find(clip => clip.id === 'clip-b');

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['clip-a', 'clip-b']);
    expect(clipA?.transitionOut).toMatchObject({ type: 'crossfade', duration: 2, linkedClipId: 'clip-b' });
    expect(clipB?.transitionIn).toMatchObject({ type: 'crossfade', duration: 2, linkedClipId: 'clip-a' });
    expect(clipA?.transitionOut?.id).toBe(clipB?.transitionIn?.id);
    expect(clipB?.startTime).toBe(10);
  });

  it('keeps requested transition duration without a max cap', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'clip-a', trackId: 'video-1', startTime: 0, duration: 4 }),
        createMockClip({ id: 'clip-b', trackId: 'video-1', startTime: 4, duration: 3 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-uncapped',
      type: 'transition-apply',
      transactionId: 'typed-transition-uncapped',
      historyBatchId: 'typed-transition-uncapped',
      source: 'ui',
      clipAId: 'clip-a',
      clipBId: 'clip-b',
      transitionType: 'crossfade',
      requestedDuration: 12,
      junction: createTransitionJunctionFixture('clip-a', 'clip-b', 4),
    }, { source: 'ui', historyLabel: 'Apply transition' });

    const clipB = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b');
    expect(result.success).toBe(true);
    expect(clipB?.transitionIn?.duration).toBe(12);
    expect(clipB?.startTime).toBe(4);
  });

  it('removes a typed transition without moving the incoming clip start', () => {
    const transition = { id: 'transition-existing', type: 'crossfade', duration: 2 };
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      propertiesSelection: {
        kind: 'transition',
        clipId: 'clip-a',
        edge: 'out',
        transitionId: 'transition-existing',
      },
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          transitionOut: { ...transition, linkedClipId: 'clip-b' },
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-1',
          startTime: 10,
          duration: 8,
          transitionIn: { ...transition, linkedClipId: 'clip-a' },
        }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-remove',
      type: 'transition-remove',
      transactionId: 'typed-transition-remove',
      historyBatchId: 'typed-transition-remove',
      source: 'ui',
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-existing',
    }, { source: 'ui', historyLabel: 'Remove transition' });

    const clips = useTimelineStore.getState().clips;
    expect(result.success).toBe(true);
    expect(clips.find(clip => clip.id === 'clip-a')?.transitionOut).toBeUndefined();
    expect(clips.find(clip => clip.id === 'clip-b')?.transitionIn).toBeUndefined();
    expect(clips.find(clip => clip.id === 'clip-b')?.startTime).toBe(10);
    expect(useTimelineStore.getState().propertiesSelection).toBeNull();
  });

  it('removes a typed transition when the connected clips are moved apart', () => {
    const transition = { id: 'transition-existing', type: 'crossfade', duration: 2 };
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      propertiesSelection: {
        kind: 'transition',
        clipId: 'clip-a',
        edge: 'out',
        transitionId: 'transition-existing',
      },
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          transitionOut: { ...transition, linkedClipId: 'clip-b' },
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-1',
          startTime: 10,
          duration: 8,
          transitionIn: { ...transition, linkedClipId: 'clip-a' },
        }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'move-transition-apart',
      type: 'move-clips',
      moves: [{ clipId: 'clip-b', startTime: 12 }],
      includeLinked: false,
    }, { source: 'ui', historyLabel: 'Move clip apart' });

    const clips = useTimelineStore.getState().clips;
    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(expect.arrayContaining(['clip-a', 'clip-b']));
    expect(clips.find(clip => clip.id === 'clip-a')?.transitionOut).toBeUndefined();
    expect(clips.find(clip => clip.id === 'clip-b')?.transitionIn).toBeUndefined();
    expect(clips.find(clip => clip.id === 'clip-b')?.startTime).toBe(12);
    expect(useTimelineStore.getState().propertiesSelection).toBeNull();
  });

  it('updates typed transition duration while preserving the transition id', () => {
    const transition = { id: 'transition-existing', type: 'crossfade', duration: 1 };
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          transitionOut: { ...transition, linkedClipId: 'clip-b' },
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-1',
          startTime: 10,
          duration: 8,
          transitionIn: { ...transition, linkedClipId: 'clip-a' },
        }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-update',
      type: 'transition-update-duration',
      transactionId: 'typed-transition-update',
      historyBatchId: 'typed-transition-update',
      source: 'ui',
      clipId: 'clip-b',
      edge: 'in',
      transitionId: 'transition-existing',
      requestedDuration: 3,
    }, { source: 'ui', historyLabel: 'Update transition duration' });

    const clipA = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a');
    const clipB = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b');
    expect(result.success).toBe(true);
    expect(clipA?.transitionOut).toMatchObject({ id: 'transition-existing', type: 'crossfade', duration: 3, linkedClipId: 'clip-b' });
    expect(clipB?.transitionIn).toMatchObject({ id: 'transition-existing', type: 'crossfade', duration: 3, linkedClipId: 'clip-a' });
    expect(clipB?.startTime).toBe(10);
  });

  it('normalizes typed transition params and mirrors them to the reciprocal edge', () => {
    const transition = {
      id: 'transition-existing',
      type: 'crossfade',
      duration: 1,
      params: { includeAudio: true },
    };
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          transitionOut: { ...transition, linkedClipId: 'clip-b' },
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-1',
          startTime: 10,
          duration: 8,
          transitionIn: { ...transition, linkedClipId: 'clip-a' },
        }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-update-params',
      type: 'transition-update-params',
      transactionId: 'typed-transition-update-params',
      historyBatchId: 'typed-transition-update-params',
      source: 'ui',
      clipId: 'clip-b',
      edge: 'in',
      transitionId: 'transition-existing',
      params: {
        includeAudio: 'not-boolean',
        unknownParam: true,
      },
    }, { source: 'ui', historyLabel: 'Update transition parameters' });

    const clipA = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a');
    const clipB = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b');
    expect(result.success).toBe(true);
    expect(clipA?.transitionOut?.params).toEqual({ includeAudio: false });
    expect(clipB?.transitionIn?.params).toEqual({ includeAudio: false });
  });

  it('normalizes params when changing transition types and drops stale schema fields', () => {
    const transition = {
      id: 'transition-existing',
      type: 'crossfade',
      duration: 1,
      params: { includeAudio: true },
    };
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          transitionOut: { ...transition, linkedClipId: 'clip-b' },
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-1',
          startTime: 10,
          duration: 8,
          transitionIn: { ...transition, linkedClipId: 'clip-a' },
        }),
      ],
    });

    const dipResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-update-type-dip',
      type: 'transition-update-type',
      transactionId: 'typed-transition-update-type-dip',
      historyBatchId: 'typed-transition-update-type-dip',
      source: 'ui',
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-existing',
      transitionType: 'dip-to-color',
      params: {
        color: 'not-a-color',
        includeAudio: true,
      },
    }, { source: 'ui', historyLabel: 'Change transition type' });

    let clipA = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a');
    let clipB = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b');
    expect(dipResult.success).toBe(true);
    expect(clipA?.transitionOut).toMatchObject({ id: 'transition-existing', type: 'dip-to-color' });
    expect(clipB?.transitionIn).toMatchObject({ id: 'transition-existing', type: 'dip-to-color' });
    expect(clipA?.transitionOut?.params).toEqual({ color: '#000000' });
    expect(clipB?.transitionIn?.params).toEqual({ color: '#000000' });

    const wipeResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-update-type-wipe',
      type: 'transition-update-type',
      transactionId: 'typed-transition-update-type-wipe',
      historyBatchId: 'typed-transition-update-type-wipe',
      source: 'ui',
      clipId: 'clip-b',
      edge: 'in',
      transitionId: 'transition-existing',
      transitionType: 'wipe-left',
      params: {
        color: '#ff0000',
      },
    }, { source: 'ui', historyLabel: 'Change transition type' });

    clipA = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a');
    clipB = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b');
    expect(wipeResult.success).toBe(true);
    expect(clipA?.transitionOut).toMatchObject({ id: 'transition-existing', type: 'wipe-left' });
    expect(clipB?.transitionIn).toMatchObject({ id: 'transition-existing', type: 'wipe-left' });
    expect(clipA?.transitionOut?.params).toBeUndefined();
    expect(clipB?.transitionIn?.params).toBeUndefined();

    const waterDropResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-update-type-water-drop',
      type: 'transition-update-type',
      transactionId: 'typed-transition-update-type-water-drop',
      historyBatchId: 'typed-transition-update-type-water-drop',
      source: 'ui',
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-existing',
      transitionType: 'water-drop',
      params: {
        seed: 2_000_000,
      },
    }, { source: 'ui', historyLabel: 'Change transition type' });

    clipA = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a');
    clipB = useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b');
    expect(waterDropResult.success).toBe(true);
    expect(clipA?.transitionOut).toMatchObject({ id: 'transition-existing', type: 'water-drop' });
    expect(clipB?.transitionIn).toMatchObject({ id: 'transition-existing', type: 'water-drop' });
    expect(clipA?.transitionOut?.params).toEqual({ seed: 1_000_000 });
    expect(clipB?.transitionIn?.params).toEqual({ seed: 1_000_000 });
  });

  it('undoes and redoes reciprocal transition param updates', () => {
    const transition = {
      id: 'transition-existing',
      type: 'crossfade',
      duration: 1,
      params: { includeAudio: true },
    };
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          transitionOut: { ...transition, linkedClipId: 'clip-b' },
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-1',
          startTime: 10,
          duration: 8,
          transitionIn: { ...transition, linkedClipId: 'clip-a' },
        }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-history-params',
      type: 'transition-update-params',
      transactionId: 'typed-transition-history-params',
      historyBatchId: 'typed-transition-history-params',
      source: 'ui',
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-existing',
      params: { includeAudio: false },
    }, { source: 'ui', historyLabel: 'Update transition parameters' });

    expect(result.success).toBe(true);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a')?.transitionOut?.params)
      .toEqual({ includeAudio: false });

    expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a')?.transitionOut?.params)
      .toEqual({ includeAudio: true });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b')?.transitionIn?.params)
      .toEqual({ includeAudio: true });

    expect(useHistoryStore.getState().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-a')?.transitionOut?.params)
      .toEqual({ includeAudio: false });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-b')?.transitionIn?.params)
      .toEqual({ includeAudio: false });
  });

  it('normalizes known transition params but preserves future transition params while serializing', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          transitionOut: {
            id: 'transition-known',
            type: 'dip-to-color',
            duration: 1,
            linkedClipId: 'clip-b',
            params: {
              color: '#00ff00',
              staleParam: true,
            },
          },
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-1',
          startTime: 10,
          duration: 8,
          transitionIn: {
            id: 'transition-known',
            type: 'dip-to-color',
            duration: 1,
            linkedClipId: 'clip-a',
            params: {
              color: 'invalid-color',
              staleParam: true,
            },
          },
        }),
        createMockClip({
          id: 'clip-c',
          trackId: 'video-1',
          startTime: 18,
          duration: 5,
          transitionOut: {
            id: 'transition-future',
            type: 'future-volumetric-wipe',
            duration: 1,
            linkedClipId: 'clip-d',
            params: {
              seed: 123,
              mode: 'draft',
            },
          },
        }),
      ],
    });

    const serialized = useTimelineStore.getState().getSerializableState();

    expect(serialized.clips.find(clip => clip.id === 'clip-a')?.transitionOut?.params)
      .toEqual({ color: '#00ff00' });
    expect(serialized.clips.find(clip => clip.id === 'clip-b')?.transitionIn?.params)
      .toEqual({ color: '#000000' });
    expect(serialized.clips.find(clip => clip.id === 'clip-c')?.transitionOut?.params)
      .toEqual({ seed: 123, mode: 'draft' });
  });

  it('rejects planned transition ids before writing clip metadata', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'clip-a', trackId: 'video-1', startTime: 0, duration: 10 }),
        createMockClip({ id: 'clip-b', trackId: 'video-1', startTime: 10, duration: 8 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-planned-rejected',
      type: 'transition-apply',
      transactionId: 'typed-transition-planned-rejected',
      historyBatchId: 'typed-transition-planned-rejected',
      source: 'ui',
      clipAId: 'clip-a',
      clipBId: 'clip-b',
      transitionType: 'page-peel',
      requestedDuration: 1,
      junction: createTransitionJunctionFixture(),
    }, { source: 'ui', historyLabel: 'Apply transition' });

    expect(result.success).toBe(false);
    expect(result.warnings[0]).toMatchObject({
      code: 'unsupported',
      message: 'Unsupported transition type: page-peel',
    });
    expect(useTimelineStore.getState().clips.some(clip => clip.transitionIn || clip.transitionOut)).toBe(false);
  });

  it('blocks typed transition operations on locked tracks', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video', locked: true })],
      clips: [
        createMockClip({ id: 'clip-a', trackId: 'video-1', startTime: 0, duration: 10 }),
        createMockClip({ id: 'clip-b', trackId: 'video-1', startTime: 10, duration: 8 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'typed-transition-locked',
      type: 'transition-apply',
      transactionId: 'typed-transition-locked',
      historyBatchId: 'typed-transition-locked',
      source: 'ui',
      clipAId: 'clip-a',
      clipBId: 'clip-b',
      transitionType: 'crossfade',
      requestedDuration: 1,
      junction: createTransitionJunctionFixture(),
    }, { source: 'ui', historyLabel: 'Apply transition' });

    expect(result.success).toBe(false);
    expect(result.warnings[0]?.code).toBe('track-locked');
    expect(useTimelineStore.getState().clips.some(clip => clip.transitionIn || clip.transitionOut)).toBe(false);
  });

  it('deletes a gap at time by shifting following clips left', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 5, duration: 2 }),
      ],
    });

    const result = useTimelineStore.getState().deleteGapAtTime(3);

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['a', 0],
      ['b', 2],
    ]);
  });

  it('deletes a track gap without desyncing linked audio', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'video-a', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'video-b', trackId: 'video-1', startTime: 5, duration: 2, linkedClipId: 'audio-b' }),
        createMockClip({ id: 'audio-b', trackId: 'audio-1', startTime: 5, duration: 2, linkedClipId: 'video-b', source: { type: 'audio' } }),
        createMockClip({ id: 'audio-free', trackId: 'audio-1', startTime: 8, duration: 1, source: { type: 'audio' } }),
      ],
    });

    const result = useTimelineStore.getState().deleteGapAtTime(3, ['video-1']);

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['video-a', 0],
      ['video-b', 2],
      ['audio-b', 2],
      ['audio-free', 8],
    ]);
  });

  it('deletes all gaps on unlocked visible tracks', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'v-a', trackId: 'video-1', startTime: 1, duration: 2 }),
        createMockClip({ id: 'v-b', trackId: 'video-1', startTime: 6, duration: 2 }),
        createMockClip({ id: 'a-a', trackId: 'audio-1', startTime: 0, duration: 1 }),
        createMockClip({ id: 'a-b', trackId: 'audio-1', startTime: 3, duration: 1 }),
      ],
    });

    const result = useTimelineStore.getState().deleteAllGaps();

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['v-a', 0],
      ['v-b', 2],
      ['a-a', 0],
      ['a-b', 1],
    ]);
  });

  it('can delete all gaps on one requested track only', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'v-a', trackId: 'video-1', startTime: 0, duration: 2 }),
        createMockClip({ id: 'v-b', trackId: 'video-1', startTime: 5, duration: 2 }),
        createMockClip({ id: 'a-a', trackId: 'audio-1', startTime: 0, duration: 1 }),
        createMockClip({ id: 'a-b', trackId: 'audio-1', startTime: 4, duration: 1 }),
      ],
    });

    const result = useTimelineStore.getState().deleteAllGaps(['video-1']);

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['v-a', 0],
      ['v-b', 2],
      ['a-a', 0],
      ['a-b', 4],
    ]);
  });

  it('can delete all later gaps on one requested track from a clicked gap', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'v-a', trackId: 'video-1', startTime: 2, duration: 2 }),
        createMockClip({ id: 'v-b', trackId: 'video-1', startTime: 7, duration: 2 }),
        createMockClip({ id: 'v-c', trackId: 'video-1', startTime: 12, duration: 2 }),
        createMockClip({ id: 'a-a', trackId: 'audio-1', startTime: 0, duration: 1 }),
        createMockClip({ id: 'a-b', trackId: 'audio-1', startTime: 4, duration: 1 }),
      ],
    });

    const result = useTimelineStore.getState().deleteAllGaps(['video-1'], 10);

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['v-a', 2],
      ['v-b', 7],
      ['v-c', 9],
      ['a-a', 0],
      ['a-b', 4],
    ]);
  });

  it('moves linked clips through the operation kernel', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 1,
      duration: 4,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 1,
      duration: 4,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'move-linked',
      type: 'move-clips',
      moves: [{ clipId: 'video-1', startTime: 6 }],
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: move clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ['video-1', 6],
      ['audio-1', 6],
    ]);
  });

  it('applies resolved move overlap trims in one operation kernel path', () => {
    const moving = createMockClip({
      id: 'moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video' },
    });
    const overlapped = createMockClip({
      id: 'overlapped',
      trackId: 'video-1',
      startTime: 5,
      duration: 4,
      inPoint: 10,
      outPoint: 14,
      source: { type: 'video' },
    });
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-overlap',
      clips: [moving, overlapped],
      tracks,
      clipId: 'moving',
      requestedStartTime: 3,
      getPositionWithResistance: () => ({
        startTime: 3,
        forcingOverlap: true,
      }),
    });
    useTimelineStore.setState({
      tracks,
      clips: [moving, overlapped],
      selectedClipIds: new Set(['moving', 'overlapped']),
      primarySelectedClipId: 'overlapped',
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'resolved-move-overlap',
      type: 'move-clips-resolved',
      resolvedMoves: resolution.resolvedMoves,
    }, { source: 'ui', historyLabel: 'Move clip' });

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['moving', 'overlapped']);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['moving', 3, 0, 3, 3],
      ['overlapped', 6, 11, 14, 3],
    ]);
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['moving', 'overlapped']);
    expect(useTimelineStore.getState().primarySelectedClipId).toBe('overlapped');
  });

  it('removes covered overlap victims from selection in resolved move operations', () => {
    const moving = createMockClip({
      id: 'moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'video' },
    });
    const covered = createMockClip({
      id: 'covered',
      trackId: 'video-1',
      startTime: 4,
      duration: 2,
      inPoint: 10,
      outPoint: 12,
      source: { type: 'video' },
    });
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-covered-overlap',
      clips: [moving, covered],
      tracks,
      clipId: 'moving',
      requestedStartTime: 3,
      getPositionWithResistance: () => ({
        startTime: 3,
        forcingOverlap: true,
      }),
    });
    useTimelineStore.setState({
      tracks,
      clips: [moving, covered],
      selectedClipIds: new Set(['moving', 'covered']),
      primarySelectedClipId: 'covered',
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'resolved-move-covered-overlap',
      type: 'move-clips-resolved',
      resolvedMoves: resolution.resolvedMoves,
    }, { source: 'ui', historyLabel: 'Move clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map(clip => clip.id)).toEqual(['moving']);
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['moving']);
    expect(useTimelineStore.getState().primarySelectedClipId).toBe('moving');
  });

  it('applies resolved move overlap trims to linked clip partners', () => {
    const moving = createMockClip({
      id: 'moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video' },
    });
    const linkedVideo = createMockClip({
      id: 'linked-video',
      trackId: 'video-1',
      startTime: 5,
      duration: 4,
      inPoint: 10,
      outPoint: 14,
      linkedClipId: 'linked-audio',
      source: { type: 'video' },
    });
    const linkedAudio = createMockClip({
      id: 'linked-audio',
      trackId: 'audio-1',
      startTime: 5,
      duration: 4,
      inPoint: 10,
      outPoint: 14,
      linkedClipId: 'linked-video',
      source: { type: 'audio' },
    });
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-linked-overlap',
      clips: [moving, linkedVideo, linkedAudio],
      tracks,
      clipId: 'moving',
      requestedStartTime: 3,
      getPositionWithResistance: () => ({
        startTime: 3,
        forcingOverlap: true,
      }),
    });
    useTimelineStore.setState({
      tracks,
      clips: [moving, linkedVideo, linkedAudio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'resolved-move-linked-overlap',
      type: 'move-clips-resolved',
      resolvedMoves: resolution.resolvedMoves,
    }, { source: 'ui', historyLabel: 'Move clip' });

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['moving', 'linked-video', 'linked-audio']);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.duration])).toEqual([
      ['moving', 3, 0, 3],
      ['linked-video', 6, 11, 3],
      ['linked-audio', 6, 11, 3],
    ]);
  });

  it('materializes resolved fallback tracks inside the operation kernel', () => {
    const moving = createMockClip({
      id: 'moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      source: { type: 'video' },
    });
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'video-2', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-fallback-track',
      clips: [moving],
      tracks,
      clipId: 'moving',
      requestedStartTime: 6,
      requestedNewTrackType: 'video',
    });
    useTimelineStore.setState({
      tracks,
      clips: [moving],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'resolved-move-fallback-track',
      type: 'move-clips-resolved',
      resolvedMoves: resolution.resolvedMoves,
    }, { source: 'ui', historyLabel: 'Move clip' });

    const state = useTimelineStore.getState();
    const fallbackTrack = state.tracks.find(track =>
      track.type === 'video' && !tracks.some(originalTrack => originalTrack.id === track.id));
    const movedClip = state.clips.find(clip => clip.id === 'moving');

    expect(resolution.resolvedMoves[0]?.fallbackTrack).toMatchObject({
      createFallbackTrack: true,
      reason: 'explicit-new-track-zone',
    });
    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['moving']);
    expect(fallbackTrack).toBeDefined();
    expect(movedClip).toMatchObject({
      startTime: 6,
      trackId: fallbackTrack?.id,
    });
  });

  it('applies selected linked-pair resolved moves while preserving offsets', () => {
    const video = createMockClip({
      id: 'video',
      trackId: 'video-1',
      startTime: 3,
      duration: 4,
      linkedClipId: 'audio',
      source: { type: 'video' },
    });
    const audio = createMockClip({
      id: 'audio',
      trackId: 'audio-1',
      startTime: 3.5,
      duration: 4,
      linkedClipId: 'video',
      source: { type: 'audio' },
    });
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-selected-linked-pair',
      clips: [video, audio],
      tracks,
      clipId: 'video',
      requestedStartTime: 8,
      selectedClipIds: ['video', 'audio'],
    });
    const operationPlan = createResolvedClipMoveOperationPlan(
      resolution.id,
      resolution.resolvedMoves,
      resolution.warnings,
    );
    const operationToApply = operationPlan.canApplyWithMoveClipsOperation
      ? operationPlan.operation
      : {
        id: resolution.id,
        type: 'move-clips-resolved' as const,
        resolvedMoves: resolution.resolvedMoves,
      };
    useTimelineStore.setState({
      tracks,
      clips: [video, audio],
      selectedClipIds: new Set(['video', 'audio']),
      primarySelectedClipId: 'video',
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      operationToApply,
      { source: 'ui', historyLabel: 'Move selected clips' },
    );

    expect(operationPlan.canApplyWithMoveClipsOperation).toBe(false);
    expect(operationPlan.blockedReasons).toEqual(['selected-linked-pair']);
    expect(operationToApply.type).toBe('move-clips-resolved');
    expect(resolution.resolvedMoves.map(move => move.selectedLinkedPair.preservedOffsets)).toEqual([true, true]);
    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['video', 'audio']);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.trackId])).toEqual([
      ['video', 8, 'video-1'],
      ['audio', 8.5, 'audio-1'],
    ]);
    expect(useTimelineStore.getState().primarySelectedClipId).toBe('video');
  });

  it('applies linked group resolved moves through the typed operation kernel', () => {
    const clips = [
      createMockClip({ id: 'lead', trackId: 'video-1', startTime: 1, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-video', trackId: 'video-1', startTime: 4, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-audio', trackId: 'audio-1', startTime: 5, duration: 2, linkedGroupId: 'group-1', source: { type: 'audio' } }),
    ];
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-linked-group',
      clips,
      tracks,
      clipId: 'lead',
      requestedStartTime: 6,
    });
    const operationPlan = createResolvedClipMoveOperationPlan(
      resolution.id,
      resolution.resolvedMoves,
      resolution.warnings,
    );
    useTimelineStore.setState({ tracks, clips });

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      operationPlan.operation,
      { source: 'ui', historyLabel: 'Move linked group' },
    );

    expect(operationPlan.canApplyWithMoveClipsOperation).toBe(true);
    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['lead', 'group-video', 'group-audio']);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.trackId])).toEqual([
      ['lead', 6, 'video-1'],
      ['group-video', 9, 'video-1'],
      ['group-audio', 10, 'audio-1'],
    ]);
  });

  it('keeps linked group followers in place when group following is disabled', () => {
    const clips = [
      createMockClip({ id: 'lead', trackId: 'video-1', startTime: 1, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-video', trackId: 'video-1', startTime: 4, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-audio', trackId: 'audio-1', startTime: 5, duration: 2, linkedGroupId: 'group-1', source: { type: 'audio' } }),
    ];
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio' }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-linked-group-disabled',
      clips,
      tracks,
      clipId: 'lead',
      requestedStartTime: 6,
      includeGroups: false,
    });
    useTimelineStore.setState({ tracks, clips });

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      resolution.operation,
      { source: 'ui', historyLabel: 'Move ungrouped clip' },
    );

    expect(result.success).toBe(true);
    expect(result.changedClipIds).toEqual(['lead']);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.trackId])).toEqual([
      ['lead', 6, 'video-1'],
      ['group-video', 4, 'video-1'],
      ['group-audio', 5, 'audio-1'],
    ]);
  });

  it('blocks linked group resolved moves when a follower track is locked', () => {
    const clips = [
      createMockClip({ id: 'lead', trackId: 'video-1', startTime: 1, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-audio', trackId: 'audio-1', startTime: 5, duration: 2, linkedGroupId: 'group-1', source: { type: 'audio' } }),
    ];
    const tracks = [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'audio-1', type: 'audio', locked: true }),
    ];

    const resolution = resolveClipMoveRequest({
      id: 'resolved-move-linked-group-locked',
      clips,
      tracks,
      clipId: 'lead',
      requestedStartTime: 6,
    });

    expect(resolution.resolvedMoves).toEqual([]);
    expect(resolution.operation.moves).toEqual([]);
    expect(resolution.warnings[0]).toMatchObject({
      code: 'track-locked',
      clipId: 'group-audio',
      trackId: 'audio-1',
    });
  });

  it('trims linked clips through the operation kernel', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'trim-linked',
      type: 'trim-clip',
      clipId: 'video-1',
      inPoint: 1,
      outPoint: 6,
      includeLinked: true,
    }, { source: 'ai-tool', historyLabel: 'AI: trim clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 1, 6, 5],
      ['audio-1', 1, 6, 5],
    ]);
  });

  it('preserves linked clip duration differences when trimming again after an independent trim', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'trim-linked-after-independent-trim',
      type: 'trim-clip',
      clipId: 'video-1',
      inPoint: 0,
      outPoint: 10,
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Trim linked clips' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 0, 10, 10],
      ['audio-1', 0, 7, 7],
    ]);
  });

  it('trims selected clip start to the playhead and keeps linked audio aligned', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
      selectedClipIds: new Set(['video-1']),
      playheadPosition: 3,
    });

    const result = useTimelineStore.getState().trimSelectedClipEdgeToPlayhead('start');

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 3, 3, 8, 5],
      ['audio-1', 3, 3, 8, 5],
    ]);
  });

  it('ripple trims a linked clip head and shifts following linked tracks together', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'video-1', trackId: 'video-1', startTime: 0, duration: 6, inPoint: 0, outPoint: 6, linkedClipId: 'audio-1' }),
        createMockClip({ id: 'audio-1', trackId: 'audio-1', startTime: 0, duration: 6, inPoint: 0, outPoint: 6, linkedClipId: 'video-1', source: { type: 'audio' } }),
        createMockClip({ id: 'video-2', trackId: 'video-1', startTime: 6, duration: 2, inPoint: 0, outPoint: 2, linkedClipId: 'audio-2' }),
        createMockClip({ id: 'audio-2', trackId: 'audio-1', startTime: 6, duration: 2, inPoint: 0, outPoint: 2, linkedClipId: 'video-2', source: { type: 'audio' } }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'ripple-trim-linked-head',
      type: 'ripple-trim-edge-to-time',
      edge: 'start',
      time: 2,
      clipIds: ['video-1'],
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Ripple trim linked head' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-1', 0, 2, 6, 4],
      ['audio-1', 0, 2, 6, 4],
      ['video-2', 4, 0, 2, 2],
      ['audio-2', 4, 0, 2, 2],
    ]);
  });

  it('rolls an edit point across linked video and audio pairs', () => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'video-a', trackId: 'video-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'audio-a' }),
        createMockClip({ id: 'video-b', trackId: 'video-1', startTime: 5, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'audio-b' }),
        createMockClip({ id: 'audio-a', trackId: 'audio-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'video-a', source: { type: 'audio' } }),
        createMockClip({ id: 'audio-b', trackId: 'audio-1', startTime: 5, duration: 5, inPoint: 0, outPoint: 5, linkedClipId: 'video-b', source: { type: 'audio' } }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'roll-linked',
      type: 'rolling-edit',
      clipId: 'video-a',
      edge: 'end',
      time: 6,
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Rolling edit linked' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['video-a', 0, 0, 6, 6],
      ['video-b', 6, 1, 5, 4],
      ['audio-a', 0, 0, 6, 6],
      ['audio-b', 6, 1, 5, 4],
    ]);
  });

  it('slips source timing without moving the clip on the timeline', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'video-1',
          startTime: 5,
          duration: 4,
          inPoint: 2,
          outPoint: 6,
          source: { type: 'video', naturalDuration: 12 },
        }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'slip-source',
      type: 'slip-clip',
      clipId: 'clip-1',
      sourceDelta: 3,
    }, { source: 'ui', historyLabel: 'Slip clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['clip-1', 5, 5, 9, 4],
    ]);
  });

  it('slides a clip by counter-trimming adjacent clips', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'prev', trackId: 'video-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5 }),
        createMockClip({ id: 'mid', trackId: 'video-1', startTime: 5, duration: 2, inPoint: 0, outPoint: 2 }),
        createMockClip({ id: 'next', trackId: 'video-1', startTime: 7, duration: 5, inPoint: 0, outPoint: 5 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'slide-mid',
      type: 'slide-clip',
      clipId: 'mid',
      timelineDelta: 2,
    }, { source: 'ui', historyLabel: 'Slide clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime, clip.inPoint, clip.outPoint, clip.duration])).toEqual([
      ['prev', 0, 0, 7, 7],
      ['mid', 7, 0, 2, 2],
      ['next', 9, 2, 5, 3],
    ]);
  });

  it('rate-stretches a clip by changing duration and playback speed', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5, speed: 1 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'rate-stretch-end',
      type: 'rate-stretch-clip',
      clipId: 'clip-1',
      edge: 'end',
      time: 10,
      preservesPitch: true,
    }, { source: 'ui', historyLabel: 'Rate stretch clip' });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.duration, clip.speed, clip.preservesPitch])).toEqual([
      ['clip-1', 10, 0.5, true],
    ]);
  });

  it('inserts a placement range by splitting crossing clips and shifting following clips', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 12, duration: 2, inPoint: 0, outPoint: 2 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'insert-placement-range',
      type: 'place-timeline-range',
      mode: 'insert',
      trackIds: ['video-1'],
      startTime: 5,
      duration: 3,
    }, { source: 'external-drop', historyLabel: 'Insert placement test' });

    const clips = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === 'video-1')
      .toSorted((left, right) => left.startTime - right.startTime);

    expect(result.success).toBe(true);
    expect(clips).toHaveLength(3);
    expect(clips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 5, 0, 5],
      [8, 5, 5, 10],
      [15, 2, 0, 2],
    ]);
  });

  it('overwrites a placement range by trimming and deleting existing clips', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 5, duration: 2, inPoint: 0, outPoint: 2 }),
        createMockClip({ id: 'c', trackId: 'video-1', startTime: 12, duration: 6, inPoint: 0, outPoint: 6 }),
      ],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'overwrite-placement-range',
      type: 'place-timeline-range',
      mode: 'position-overwrite',
      trackIds: ['video-1'],
      startTime: 4,
      duration: 10,
    }, { source: 'external-drop', historyLabel: 'Overwrite placement test' });

    const clips = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === 'video-1')
      .toSorted((left, right) => left.startTime - right.startTime);

    expect(result.success).toBe(true);
    expect(clips.map((clip) => clip.id)).toEqual(['a', 'c']);
    expect(clips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 4, 0, 4],
      [14, 4, 2, 6],
    ]);
  });

  it('keeps split linked placement parts linked across video and audio tracks', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'linked-insert-placement-range',
      type: 'place-timeline-range',
      mode: 'insert',
      trackIds: ['video-1', 'audio-1'],
      startTime: 4,
      duration: 2,
      includeLinked: true,
    }, { source: 'external-drop', historyLabel: 'Linked insert placement test' });

    const clips = useTimelineStore.getState().clips;
    const rightVideo = clips.find((clip) => clip.trackId === 'video-1' && clip.id !== 'video-1');
    const rightAudio = clips.find((clip) => clip.trackId === 'audio-1' && clip.id !== 'audio-1');

    expect(result.success).toBe(true);
    expect(rightVideo).toBeDefined();
    expect(rightAudio).toBeDefined();
    expect(rightVideo?.startTime).toBe(6);
    expect(rightAudio?.startTime).toBe(6);
    expect(rightVideo?.linkedClipId).toBe(rightAudio?.id);
    expect(rightAudio?.linkedClipId).toBe(rightVideo?.id);
    expect(clips.find((clip) => clip.id === 'video-1')?.linkedClipId).toBe('audio-1');
    expect(clips.find((clip) => clip.id === 'audio-1')?.linkedClipId).toBe('video-1');
  });

  it('lifts a timeline range by splitting boundaries and leaving the gap', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
      ],
      timelineRangeSelection: { startTime: 3, endTime: 7, trackIds: ['video-1'] },
    });

    const result = useTimelineStore.getState().liftTimelineRange();

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().timelineRangeSelection).toBeNull();
    expect(useTimelineStore.getState().clips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 3, 0, 3],
      [7, 3, 7, 10],
    ]);
  });

  it('lifts an explicit audio region range without cutting the linked video clip', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'audio-1',
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [video, audio],
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'cut-audio-region-range',
      type: 'lift-range',
      range: { startTime: 3, endTime: 7, trackIds: ['audio-1'] },
      includeLinked: false,
    }, { source: 'ui', historyLabel: 'Cut audio region' });

    const clips = useTimelineStore.getState().clips;
    const videoClips = clips.filter((clip) => clip.trackId === 'video-1');
    const audioClips = clips
      .filter((clip) => clip.trackId === 'audio-1')
      .toSorted((a, b) => a.startTime - b.startTime);

    expect(result.success).toBe(true);
    expect(videoClips).toHaveLength(1);
    expect(videoClips[0]?.startTime).toBe(0);
    expect(videoClips[0]?.duration).toBe(10);
    expect(videoClips[0]?.linkedClipId).toBeUndefined();
    expect(audioClips.map((clip) => [clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [0, 3, 0, 3],
      [7, 3, 7, 10],
    ]);
  });

  it('extracts a timeline range by splitting boundaries and closing the gap', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 12, duration: 2, inPoint: 0, outPoint: 2 }),
      ],
      timelineRangeSelection: { startTime: 3, endTime: 7, trackIds: ['video-1'] },
    });

    const result = useTimelineStore.getState().extractTimelineRange();

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id.startsWith('a'), clip.startTime, clip.duration, clip.inPoint, clip.outPoint])).toEqual([
      [true, 0, 3, 0, 3],
      [true, 3, 3, 7, 10],
      [false, 8, 2, 0, 2],
    ]);
  });
});

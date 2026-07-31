import { describe, expect, it } from 'vitest';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineTrack } from '../../src/types/timeline';
import {
  captureVariantRangeSnapshot,
  cloneCompositionGraphForVariant,
  fingerprintVariantRangeSnapshot,
  installMaterializedTimelineVariantSet,
  materializeTimelineVariantSet,
  type VariantMaterializationIdFactory,
  type VariantTimelineSourceSnapshot,
} from '../../src/services/storyboard/variants';
import type {
  TimelineFragment,
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../src/services/storyboard/contracts';

function track(id: string, type: 'video' | 'audio' = 'video'): TimelineTrack {
  return {
    id,
    name: id,
    type,
    height: 64,
    muted: false,
    visible: true,
    solo: false,
  };
}

function clip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
): SerializableClip {
  return {
    id,
    trackId,
    name: id,
    mediaFileId: `media-${id}`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    sourceType: 'video',
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

function timeline(clips: SerializableClip[], tracks: TimelineTrack[]) {
  return {
    tracks,
    clips,
    playheadPosition: 0,
    duration: 40,
    zoom: 100,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
  };
}

function compositionGraph(): Composition[] {
  const first = clip('clip-a', 'video-1', 0, 5);
  const second = clip('clip-b', 'video-1', 5, 5);
  first.linkedClipId = second.id;
  second.linkedClipId = first.id;
  first.effects = [{
    id: 'effect-1',
    name: 'Contrast',
    type: 'contrast',
    enabled: true,
    params: { amount: 1 },
  }];
  first.masks = [{
    id: 'mask-1',
    name: 'Mask',
    vertices: [{
      id: 'vertex-1',
      x: 0,
      y: 0,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    }],
    closed: true,
    opacity: 1,
    feather: 0,
    featherQuality: 1,
    inverted: false,
    mode: 'add',
    expanded: false,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
  }];
  first.keyframes = [{
    id: 'keyframe-1',
    clipId: first.id,
    time: 1,
    property: 'mask.mask-1.path',
    value: 0,
    pathValue: {
      closed: true,
      vertices: first.masks[0]!.vertices,
    },
    easing: 'linear',
  }];
  first.transitionOut = {
    id: 'transition-1',
    type: 'crossfade',
    duration: 1,
    linkedClipId: second.id,
    compositionId: 'transition-comp',
  };
  second.transitionIn = {
    ...first.transitionOut,
    linkedClipId: first.id,
  };
  const transitionOutgoing = clip('transition-outgoing', 'transition-video', 0, 1);
  const transitionIncoming = clip('transition-incoming', 'transition-video', 0, 1);
  transitionOutgoing.transitionOut = {
    id: 'transition-inner',
    type: 'crossfade',
    duration: 1,
    linkedClipId: transitionIncoming.id,
  };
  transitionIncoming.transitionIn = {
    ...transitionOutgoing.transitionOut,
    linkedClipId: transitionOutgoing.id,
  };
  return [
    {
      id: 'base-comp',
      name: 'Base',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 40,
      backgroundColor: '#000',
      timelineData: timeline([first, second], [track('video-1')]),
    },
    {
      id: 'transition-comp',
      name: 'Editable transition',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 1,
      backgroundColor: '#000',
      timelineData: timeline(
        [transitionOutgoing, transitionIncoming],
        [track('transition-video')],
      ),
      transitionComp: {
        kind: 'transition-comp',
        sourceLayout: 'mapped-v3',
        parentCompositionId: 'base-comp',
        parentTransitionId: 'transition-1',
        parentOutgoingClipId: first.id,
        parentIncomingClipId: second.id,
        linkedOutgoingClipId: transitionOutgoing.id,
        linkedIncomingClipId: transitionIncoming.id,
        innerTransitionId: 'transition-inner',
        paddingBefore: 0,
        paddingAfter: 0,
        bodyStart: 0,
        bodyEnd: 1,
      },
    },
  ];
}

function sequentialFactory(): VariantMaterializationIdFactory {
  let index = 0;
  return (kind, sourceId) => `${kind}-${++index}-${sourceId.replaceAll('\u0000', '-')}`;
}

function variantSource(): VariantTimelineSourceSnapshot {
  return {
    schemaVersion: 1,
    compositionId: 'base-comp',
    scope: {
      startTime: 10,
      endTime: 20,
      trackIds: ['video-1'],
      includeLinked: false,
    },
    boundaryPaddingSeconds: 1,
    tracks: [{ id: 'video-1', kind: 'video', payload: { locked: false } }],
    clips: [
      {
        id: 'outside-before',
        trackId: 'video-1',
        startTime: 0,
        endTime: 5,
        linkedClipIds: [],
        payload: { name: 'outside-before' },
      },
      {
        id: 'crossing',
        trackId: 'video-1',
        startTime: 8,
        endTime: 12,
        linkedClipIds: [],
        payload: { name: 'crossing' },
      },
      {
        id: 'inside',
        trackId: 'video-1',
        startTime: 12,
        endTime: 18,
        linkedClipIds: [],
        payload: { name: 'inside' },
      },
      {
        id: 'outside-after',
        trackId: 'video-1',
        startTime: 22,
        endTime: 25,
        linkedClipIds: [],
        payload: { name: 'outside-after' },
      },
    ],
    transitions: [],
    globalState: { frameRate: 30 },
  };
}

function baseForMaterialization(): Composition {
  return {
    id: 'base-comp',
    name: 'Base',
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 40,
    backgroundColor: '#000',
    timelineData: timeline([
      clip('outside-before', 'video-1', 0, 5),
      clip('crossing', 'video-1', 8, 4),
      clip('inside', 'video-1', 12, 6),
      clip('outside-after', 'video-1', 22, 3),
    ], [track('video-1')]),
  };
}

function fragment(mediaFileId: string): TimelineFragment {
  const payload = clip('payload-template', 'unused', 0, 10);
  payload.mediaFileId = mediaFileId;
  return {
    schemaVersion: 1,
    durationSeconds: 10,
    tracks: [{ localTrackId: 'local-video', sourceTrackId: 'video-1', kind: 'video' }],
    clips: [{
      localId: 'fragment-clip',
      localTrackId: 'local-video',
      startOffsetSeconds: 0,
      durationSeconds: 10,
      payload: structuredClone(payload) as never,
    }],
    links: [],
    keyframes: [],
    effects: [],
    masks: [],
    transitions: [],
    markers: [],
    annotations: [],
    sceneIds: ['scene-1'],
    candidateIds: [],
    warnings: [],
  };
}

async function materializationFixture() {
  const base = baseForMaterialization();
  const rangeSnapshot = captureVariantRangeSnapshot(variantSource());
  const fingerprints = await fingerprintVariantRangeSnapshot(rangeSnapshot);
  const variantSet: TimelineVariantSet = {
    schemaVersion: 1,
    id: 'variant-set',
    title: 'Opening alternatives',
    baseCompositionId: base.id,
    sceneIds: ['scene-1'],
    scope: rangeSnapshot.scope,
    baseFingerprint: fingerprints.scope,
    boundaryFingerprint: fingerprints.boundary,
    status: 'building',
    optionIds: ['option-a', 'option-b', 'option-c'],
    createdAt: 1,
  };
  const options: TimelineVariantOption[] = [
    {
      schemaVersion: 1,
      id: 'option-a',
      variantSetId: variantSet.id,
      title: 'Balanced',
      rationale: 'Keep the story clear.',
      state: 'planned',
      fragment: fragment('media-a'),
      candidateIds: [],
    },
    {
      schemaVersion: 1,
      id: 'option-b',
      variantSetId: variantSet.id,
      title: 'Dynamic',
      rationale: 'Increase momentum.',
      state: 'building',
      fragment: fragment('media-b'),
      candidateIds: ['candidate-b'],
    },
    {
      schemaVersion: 1,
      id: 'option-c',
      variantSetId: variantSet.id,
      title: 'Alternative',
      rationale: 'Try a different angle.',
      state: 'building',
      fragment: fragment('media-c'),
      candidateIds: ['candidate-c'],
    },
  ];
  return { base, rangeSnapshot, variantSet, options };
}

describe('variant composition graph cloning', () => {
  it('freshens and remaps clips, owned payloads, links, and transition compositions', () => {
    const source = compositionGraph();
    const sourceSnapshot = structuredClone(source);
    const result = cloneCompositionGraphForVariant(
      source,
      'base-comp',
      sequentialFactory(),
    );
    const root = result.compositions.find(
      (composition) => composition.id === result.rootCompositionId,
    )!;
    const transitionComp = result.compositions.find(
      (composition) => composition.id !== result.rootCompositionId,
    )!;
    const first = root.timelineData!.clips[0]!;
    const second = root.timelineData!.clips[1]!;

    expect(source).toEqual(sourceSnapshot);
    expect(result.rootCompositionId).not.toBe('base-comp');
    expect(first.id).not.toBe('clip-a');
    expect(first.linkedClipId).toBe(second.id);
    expect(first.effects[0]!.id).not.toBe('effect-1');
    expect(first.masks![0]!.id).not.toBe('mask-1');
    expect(first.masks![0]!.vertices[0]!.id).not.toBe('vertex-1');
    expect(first.keyframes![0]).toMatchObject({
      clipId: first.id,
      property: `mask.${first.masks![0]!.id}.path`,
    });
    expect(first.transitionOut).toMatchObject({
      linkedClipId: second.id,
      compositionId: transitionComp.id,
    });
    expect(transitionComp.transitionComp).toMatchObject({
      parentCompositionId: root.id,
      parentOutgoingClipId: first.id,
      parentIncomingClipId: second.id,
    });
    expect(transitionComp.transitionComp!.linkedOutgoingClipId)
      .toBe(transitionComp.timelineData!.clips[0]!.id);
  });
});

describe('variant option materialization', () => {
  it('builds exactly three independent playable adapters without mutating the base', async () => {
    const { base, rangeSnapshot, variantSet, options } = await materializationFixture();
    const before = structuredClone(base);

    const results = materializeTimelineVariantSet({
      compositions: [base],
      variantSet,
      options,
      rangeSnapshot,
      candidateStates: {
        'candidate-b': 'processing',
        'candidate-c': 'failed',
      },
      idFactory: sequentialFactory(),
    });

    expect(base).toEqual(before);
    expect(new Set(results.map((result) => result.graph.rootCompositionId)).size).toBe(3);
    expect(results.map((result) => result.option.state))
      .toEqual(['ready', 'building', 'failed']);
    expect(results.map((result) => result.playable)).toEqual([true, true, false]);

    for (const result of results) {
      const root = result.graph.compositions.find(
        (composition) => composition.id === result.graph.rootCompositionId,
      )!;
      const clips = root.timelineData!.clips;
      expect(clips.some((candidate) => candidate.name === 'outside-before')).toBe(true);
      expect(clips.some((candidate) => candidate.name === 'outside-after')).toBe(true);
      expect(clips.some((candidate) => candidate.name === 'inside')).toBe(false);
      expect(clips.find((candidate) => candidate.name === 'crossing')).toMatchObject({
        startTime: 8,
        duration: 2,
      });
      expect(clips.some((candidate) => (
        candidate.startTime === 10 && candidate.duration === 10
      ))).toBe(true);
      expect(root.timelineData).toMatchObject({
        inPoint: 10,
        outPoint: 20,
        loopPlayback: true,
      });
    }
  });

  it('remaps fragment-owned payloads and internal transitions with fresh identities', async () => {
    const { base, rangeSnapshot, variantSet, options } = await materializationFixture();
    const first = options[0]!;
    first.fragment.clips = [
      {
        ...first.fragment.clips[0]!,
        localId: 'fragment-a',
        durationSeconds: 5,
      },
      {
        ...first.fragment.clips[0]!,
        localId: 'fragment-b',
        startOffsetSeconds: 5,
        durationSeconds: 5,
      },
    ];
    first.fragment.effects = [{
      ownerClipId: 'fragment-a',
      payload: {
        id: 'fragment-effect',
        name: 'Contrast',
        type: 'contrast',
        enabled: true,
        params: { amount: 1 },
      },
    }];
    first.fragment.masks = [{
      ownerClipId: 'fragment-a',
      payload: {
        id: 'fragment-mask',
        name: 'Window',
        vertices: [{
          id: 'fragment-vertex',
          x: 0,
          y: 0,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
        }],
        closed: true,
        opacity: 1,
        feather: 0,
        featherQuality: 1,
        inverted: false,
        mode: 'add',
        expanded: false,
        position: { x: 0, y: 0 },
        enabled: true,
        visible: true,
      },
    }];
    first.fragment.keyframes = [{
      ownerClipId: 'fragment-a',
      payload: {
        id: 'fragment-keyframe',
        clipId: 'fragment-a',
        time: 1,
        property: 'mask.fragment-mask.path',
        value: 0,
        pathValue: {
          closed: true,
          vertices: [{
            id: 'fragment-vertex',
            x: 0,
            y: 0,
            handleIn: { x: 0, y: 0 },
            handleOut: { x: 0, y: 0 },
          }],
        },
        easing: 'linear',
      },
    }];
    first.fragment.transitions = [{
      fromClipId: 'fragment-a',
      toClipId: 'fragment-b',
      payload: {
        id: 'fragment-transition',
        type: 'crossfade',
        duration: 0.5,
        linkedClipId: 'fragment-b',
      },
    }];

    const [result] = materializeTimelineVariantSet({
      compositions: [base],
      variantSet,
      options,
      rangeSnapshot,
      idFactory: sequentialFactory(),
    });
    const root = result!.graph.compositions.find(
      (composition) => composition.id === result!.graph.rootCompositionId,
    )!;
    const clips = root.timelineData!.clips.filter((clip) => clip.startTime >= 10);
    const fragmentA = clips.find((clip) => clip.startTime === 10)!;
    const fragmentB = clips.find((clip) => clip.startTime === 15)!;
    const mask = fragmentA.masks![0]!;

    expect(fragmentA.effects[0]!.id).not.toBe('fragment-effect');
    expect(mask.id).not.toBe('fragment-mask');
    expect(fragmentA.keyframes![0]).toMatchObject({
      clipId: fragmentA.id,
      property: `mask.${mask.id}.path`,
    });
    expect(fragmentA.keyframes![0]!.pathValue!.vertices[0]!.id)
      .toBe(mask.vertices[0]!.id);
    expect(fragmentA.transitionOut).toMatchObject({
      linkedClipId: fragmentB.id,
    });
    expect(fragmentB.transitionIn).toMatchObject({
      linkedClipId: fragmentA.id,
    });
  });

  it('fails closed for out-of-scope tracks, times, and duplicate generated ids', async () => {
    const fixture = await materializationFixture();
    fixture.options[0]!.fragment.tracks[0]!.sourceTrackId = 'unselected-track';
    expect(() => materializeTimelineVariantSet({
      compositions: [fixture.base],
      variantSet: fixture.variantSet,
      options: fixture.options,
      rangeSnapshot: fixture.rangeSnapshot,
    })).toThrow(/outside the selected scope/i);

    const timed = await materializationFixture();
    timed.options[0]!.fragment.clips[0]!.startOffsetSeconds = 9;
    timed.options[0]!.fragment.clips[0]!.durationSeconds = 2;
    expect(() => materializeTimelineVariantSet({
      compositions: [timed.base],
      variantSet: timed.variantSet,
      options: timed.options,
      rangeSnapshot: timed.rangeSnapshot,
    })).toThrow(/outside the selected scope/i);

    const duplicate = await materializationFixture();
    expect(() => materializeTimelineVariantSet({
      compositions: [duplicate.base],
      variantSet: duplicate.variantSet,
      options: duplicate.options,
      rangeSnapshot: duplicate.rangeSnapshot,
      idFactory: () => 'duplicate-id',
    })).toThrow(/duplicate id/i);
  });

  it('installs three adapters atomically in the runtime ports and opens a playable option', async () => {
    const { base, rangeSnapshot, variantSet, options } = await materializationFixture();
    const installed: Composition[] = [];
    const storedOptions: TimelineVariantOption[] = [];
    const storedSets: TimelineVariantSet[] = [];
    const opened: Array<{ id: string; time: number }> = [];

    const results = installMaterializedTimelineVariantSet({
      compositions: [base],
      variantSet,
      options,
      rangeSnapshot,
      candidateStates: {
        'candidate-b': 'processing',
        'candidate-c': 'failed',
      },
      idFactory: sequentialFactory(),
    }, {
      listCompositions: () => [base],
      installCompositions: (compositions) => installed.push(...compositions),
      putOption: (option) => storedOptions.push(option),
      putSet: (set) => storedSets.push(set),
      openComposition: (id, time) => opened.push({ id, time }),
    });

    expect(results).toHaveLength(3);
    expect(installed).toHaveLength(3);
    expect(storedOptions).toHaveLength(3);
    expect(storedSets).toEqual([expect.objectContaining({
      status: 'review',
      optionIds: ['option-a', 'option-b', 'option-c'],
    })]);
    expect(opened).toEqual([{
      id: results[0]!.graph.rootCompositionId,
      time: 10,
    }]);
    expect(installed.some((composition) => composition.id === base.id)).toBe(false);
  });

  it('refuses non-three-way comparison materialization', async () => {
    const base = baseForMaterialization();
    const rangeSnapshot = captureVariantRangeSnapshot(variantSource());
    const fingerprints = await fingerprintVariantRangeSnapshot(rangeSnapshot);
    const variantSet: TimelineVariantSet = {
      schemaVersion: 1,
      id: 'variant-set',
      title: 'Invalid',
      baseCompositionId: base.id,
      sceneIds: [],
      scope: rangeSnapshot.scope,
      baseFingerprint: fingerprints.scope,
      boundaryFingerprint: fingerprints.boundary,
      status: 'building',
      optionIds: [],
      createdAt: 1,
    };
    expect(() => materializeTimelineVariantSet({
      compositions: [base],
      variantSet,
      options: [],
      rangeSnapshot,
    })).toThrow(/exactly three/i);
  });
});

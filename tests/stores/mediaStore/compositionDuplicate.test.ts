import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand';
import type { Composition, MediaState } from '../../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../../src/types/timeline';
import type { TextClipProperties } from '../../../src/types/text';
import { createDefaultMotionLayerDefinition } from '../../../src/types/motionDesign';
import { createCompositionSlice, type CompositionActions } from '../../../src/stores/mediaStore/slices/compositionSlice';
import { planCompositionDuplicate } from '../../../src/stores/mediaStore/slices/composition/compositionDuplicate';
import { withProjectStoreSyncGuard } from '../../../src/services/project/projectStoreSyncGuard';
import { useTimelineStore } from '../../../src/stores/timeline';
import { Logger } from '../../../src/services/logger';
import { createMockClip, createMockKeyframe, createMockTrack } from '../../helpers/mockData';

vi.mock('../../../src/services/compositionRenderer', () => ({
  compositionRenderer: {
    invalidateComposition: vi.fn(),
    invalidateCompositionAndParents: vi.fn(),
    prepareComposition: vi.fn(async () => true),
  },
}));

type TestStore = MediaState & CompositionActions;

function crudWarnings() {
  return Logger.getBuffer('WARN').filter((entry) => entry.module === 'CompositionCrud');
}

const initialTimelineState = useTimelineStore.getState();

const tracks: TimelineTrack[] = [
  createMockTrack({ id: 'video-1', name: 'Video 1', type: 'video' }),
  createMockTrack({ id: 'video-2', name: 'Hidden', type: 'video', visible: false }),
  createMockTrack({ id: 'audio-1', name: 'Audio 1', type: 'audio' }),
];

const textProperties = {
  text: 'Version A',
  fontFamily: 'Inter',
  fontSize: 72,
  fontWeight: 700,
  fontStyle: 'normal',
  color: '#ffffff',
  textAlign: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.2,
  letterSpacing: 0,
  strokeEnabled: false,
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowBlur: 0,
  pathEnabled: false,
  pathPoints: [],
} as TextClipProperties;

function liveClips(): TimelineClip[] {
  return [
    createMockClip({
      id: 'null-1',
      trackId: 'video-1',
      name: 'Null',
      source: { type: 'motion-shape', naturalDuration: 5 } as TimelineClip['source'],
      motion: createDefaultMotionLayerDefinition('shape'),
    }),
    createMockClip({
      id: 'title-1',
      trackId: 'video-2',
      name: 'Title',
      source: { type: 'text', naturalDuration: 5 } as TimelineClip['source'],
      textProperties: structuredClone(textProperties),
      parentClipId: 'null-1',
      effects: [{ id: 'fx-1', name: 'Blur', type: 'blur', enabled: true, params: { radius: 4 } }],
    }),
  ];
}

function storedTimeline(clips: SerializableClip[]): NonNullable<Composition['timelineData']> {
  return {
    tracks: tracks.map((track) => ({ ...track })),
    clips,
    playheadPosition: 0,
    duration: 60,
    zoom: 50,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
  };
}

function serialClip(overrides: Partial<SerializableClip>): SerializableClip {
  return {
    id: 'clip',
    trackId: 'video-1',
    name: 'Clip',
    mediaFileId: '',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    sourceType: 'text',
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    ...overrides,
  };
}

function composition(id: string, overrides: Partial<Composition> = {}): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: 'folder-1',
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 60,
    backgroundColor: '#000000',
    timelineData: storedTimeline([serialClip({ id: 'stale-only', name: 'Stale' })]),
    ...overrides,
  };
}

function createTestStore(compositions: Composition[], activeCompositionId: string | null) {
  return createStore<TestStore>()((set, get) => ({
    compositions,
    activeCompositionId,
    openCompositionIds: activeCompositionId ? [activeCompositionId] : [],
    files: [],
    folders: [],
    selectedIds: [],
    ...createCompositionSlice(
      (partial) => set(partial as Partial<TestStore>),
      () => get(),
    ),
  }) as unknown as TestStore);
}

describe('duplicateComposition', () => {
  beforeEach(() => {
    Logger.clear();
    useTimelineStore.setState(initialTimelineState);
    useTimelineStore.setState({
      tracks: tracks.map((track) => ({ ...track })),
      clips: liveClips(),
      clipKeyframes: new Map([
        ['title-1', [createMockKeyframe({ id: 'kf-1', clipId: 'title-1', property: 'opacity', time: 1, value: 0.5 })]],
      ]),
      duration: 42,
    });
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.restoreAllMocks();
  });

  it('copies the live timeline of the active composition, not its stale stored mirror', () => {
    const store = createTestStore([composition('comp-a')], 'comp-a');

    const copy = store.getState().duplicateComposition('comp-a');

    expect(copy).not.toBeNull();
    expect(copy!.timelineData!.clips.map((clip) => clip.id)).toEqual(['null-1', 'title-1']);
    expect(copy!.duration).toBe(42);
    const title = copy!.timelineData!.clips.find((clip) => clip.id === 'title-1')!;
    expect(title.parentClipId).toBe('null-1');
    expect(title.keyframes).toEqual([expect.objectContaining({ id: 'kf-1', clipId: 'title-1', value: 0.5 })]);
    expect(title.effects).toEqual([expect.objectContaining({ id: 'fx-1', params: { radius: 4 } })]);
    expect(title.textProperties?.text).toBe('Version A');
    const shape = copy!.timelineData!.clips.find((clip) => clip.id === 'null-1')!;
    expect(shape.motion?.appearance?.items).toHaveLength(1);
    expect(copy!.timelineData!.tracks.find((track) => track.id === 'video-2')?.visible).toBe(false);
    expect(copy!.parentId).toBe('folder-1');

    // The original's mirror is refreshed in the same write, so both entries agree.
    const original = store.getState().compositions.find((entry) => entry.id === 'comp-a')!;
    expect(original.timelineData!.clips.map((clip) => clip.id)).toEqual(['null-1', 'title-1']);
  });

  it('shares no mutable object with the original or the live timeline', () => {
    const store = createTestStore([composition('comp-a', { camera: { enabled: true } as Composition['camera'] })], 'comp-a');
    const copy = store.getState().duplicateComposition('comp-a')!;
    const original = store.getState().compositions.find((entry) => entry.id === 'comp-a')!;

    const copyTitle = copy.timelineData!.clips.find((clip) => clip.id === 'title-1')!;
    copyTitle.effects[0].params.radius = 99;
    copyTitle.keyframes![0].value = 0;
    copyTitle.transform.position.x = 500;
    copyTitle.textProperties!.text = 'Version B';
    copy.timelineData!.clips.find((clip) => clip.id === 'null-1')!.motion!.appearance!.items[0].visible = false;
    copy.timelineData!.tracks[1].visible = true;
    (copy.camera as { enabled: boolean }).enabled = false;

    const originalTitle = original.timelineData!.clips.find((clip) => clip.id === 'title-1')!;
    expect(originalTitle.effects[0].params.radius).toBe(4);
    expect(originalTitle.keyframes![0].value).toBe(0.5);
    expect(originalTitle.transform.position.x).toBe(0);
    expect(originalTitle.textProperties!.text).toBe('Version A');
    expect(original.timelineData!.clips.find((clip) => clip.id === 'null-1')!.motion!.appearance!.items[0].visible)
      .not.toBe(false);
    expect(original.timelineData!.tracks[1].visible).toBe(false);
    expect((original.camera as { enabled: boolean }).enabled).toBe(true);

    const liveTitle = useTimelineStore.getState().clips.find((clip) => clip.id === 'title-1')!;
    expect(liveTitle.effects[0].params.radius).toBe(4);
    expect(liveTitle.textProperties!.text).toBe('Version A');
    expect(useTimelineStore.getState().clipKeyframes.get('title-1')![0].value).toBe(0.5);
  });

  it('copies an inactive composition from its stored timeline and applies a requested name', () => {
    const store = createTestStore([composition('comp-a'), composition('comp-b')], 'comp-a');

    const copy = store.getState().duplicateComposition('comp-b', { name: '  Version 2  ' });

    expect(copy!.name).toBe('Version 2');
    expect(copy!.timelineData!.clips.map((clip) => clip.id)).toEqual(['stale-only']);
    // The unrelated active composition is not rewritten.
    const active = store.getState().compositions.find((entry) => entry.id === 'comp-a')!;
    expect(active.timelineData!.clips.map((clip) => clip.id)).toEqual(['stale-only']);
  });

  it('falls back to the stored timeline and says so while a restore holds the store-sync guard', async () => {
    const store = createTestStore([composition('comp-a')], 'comp-a');
    let copy: Composition | null = null;

    await withProjectStoreSyncGuard(async () => {
      copy = store.getState().duplicateComposition('comp-a');
    });

    expect(copy!.timelineData!.clips.map((clip) => clip.id)).toEqual(['stale-only']);
    expect(crudWarnings()).toEqual([expect.objectContaining({
      message: 'Duplicating the stored timeline of the active composition',
      data: expect.objectContaining({ compositionId: 'comp-a' }),
    })]);
  });

  it('refuses transition and caption compositions with a logged reason', () => {
    const store = createTestStore([
      composition('comp-a'),
      composition('transition-a', {
        transitionComp: { kind: 'transition-comp', parentCompositionId: 'comp-a' } as Composition['transitionComp'],
      }),
      composition('caption-a', {
        captionComp: { kind: 'caption-comp', parentCompositionId: 'comp-a' } as Composition['captionComp'],
      }),
    ], null);

    expect(store.getState().duplicateComposition('transition-a')).toBeNull();
    expect(store.getState().duplicateComposition('caption-a')).toBeNull();
    expect(store.getState().duplicateComposition('missing')).toBeNull();
    expect(store.getState().compositions).toHaveLength(3);
    expect(crudWarnings().map((entry) => [entry.message, entry.data])).toEqual([
      ['Composition duplicate refused', {
        compositionId: 'transition-a',
        reason: expect.stringContaining('private composition of a transition in composition comp-a'),
      }],
      ['Composition duplicate refused', {
        compositionId: 'caption-a',
        reason: expect.stringContaining('private caption composition of composition comp-a'),
      }],
      ['Composition duplicate refused', { compositionId: 'missing', reason: 'Composition not found: missing' }],
    ]);
  });

  it('gives the copy its own private transition and caption compositions', () => {
    const transitionLink = {
      kind: 'transition-comp',
      parentCompositionId: 'comp-a',
      parentTransitionId: 'tr-1',
      parentOutgoingClipId: 'out-1',
      parentIncomingClipId: 'in-1',
      linkedOutgoingClipId: 'out-1',
      linkedIncomingClipId: 'in-1',
      innerTransitionId: 'tr-inner',
      legacyBackupCompositionId: 'transition-backup',
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0,
      bodyEnd: 1,
    } as NonNullable<Composition['transitionComp']>;
    const parent = composition('comp-a', {
      timelineData: storedTimeline([
        serialClip({
          id: 'out-1',
          transitionOut: { id: 'tr-1', type: 'crossfade', duration: 1, linkedClipId: 'in-1', compositionId: 'transition-a' },
        }),
        serialClip({
          id: 'in-1',
          startTime: 4,
          transitionIn: { id: 'tr-1', type: 'crossfade', duration: 1, linkedClipId: 'out-1', compositionId: 'transition-a' },
        }),
        serialClip({ id: 'captions-1', isComposition: true, compositionId: 'caption-a' }),
        serialClip({ id: 'nested-1', isComposition: true, compositionId: 'shared-comp' }),
        serialClip({
          id: 'gone-1',
          transitionOut: { id: 'tr-2', type: 'crossfade', duration: 1, linkedClipId: 'out-1', compositionId: 'missing-transition' },
        }),
      ]),
    });
    const compositions = [
      parent,
      composition('transition-a', { transitionComp: transitionLink }),
      composition('transition-backup', {
        transitionComp: { ...transitionLink, legacyBackupCompositionId: undefined },
      }),
      composition('caption-a', {
        captionComp: { kind: 'caption-comp', parentCompositionId: 'comp-a' } as Composition['captionComp'],
      }),
      composition('shared-comp'),
    ];
    let next = 0;

    const plan = planCompositionDuplicate({
      compositions,
      sourceId: 'comp-a',
      name: 'Copy',
      createId: () => `new-${++next}`,
      createdAt: 5,
    });

    const ids = plan.compositionIdMap;
    const copyClips = new Map(plan.duplicate.timelineData!.clips.map((clip) => [clip.id, clip]));
    expect(copyClips.get('out-1')!.transitionOut!.compositionId).toBe(ids.get('transition-a'));
    expect(copyClips.get('in-1')!.transitionIn!.compositionId).toBe(ids.get('transition-a'));
    expect(copyClips.get('captions-1')!.compositionId).toBe(ids.get('caption-a'));
    expect(copyClips.get('nested-1')!.compositionId).toBe('shared-comp');
    expect(copyClips.get('gone-1')!.transitionOut!.compositionId).toBeUndefined();
    expect(plan.droppedTransitionCompositionIds).toEqual(['missing-transition']);
    expect(ids.has('shared-comp')).toBe(false);

    const copies = new Map(plan.privateCopies.map((entry) => [entry.id, entry]));
    expect(copies.size).toBe(3);
    const transitionCopy = copies.get(ids.get('transition-a')!)!;
    expect(transitionCopy.transitionComp!.parentCompositionId).toBe(plan.duplicate.id);
    expect(transitionCopy.transitionComp!.legacyBackupCompositionId).toBe(ids.get('transition-backup'));
    expect(transitionCopy.transitionComp!.parentOutgoingClipId).toBe('out-1');
    expect(copies.get(ids.get('caption-a')!)!.captionComp!.parentCompositionId).toBe(plan.duplicate.id);

    // Originals keep pointing at their own private compositions.
    expect(parent.timelineData!.clips[0].transitionOut!.compositionId).toBe('transition-a');
    expect(compositions[1].transitionComp!.parentCompositionId).toBe('comp-a');
  });
});

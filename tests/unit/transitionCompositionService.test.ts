import { describe, expect, it, vi } from 'vitest';

import { ensureTransitionCompositionForPair } from '../../src/services/timeline/transitionCompositionService';
import type { Composition } from '../../src/stores/mediaStore';
import { getAllTransitions } from '../../src/transitions';
import type { SerializableClip, TimelineClip } from '../../src/types/timeline';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

function serializableClip(id: string, startTime: number): SerializableClip {
  return {
    id,
    trackId: 'track-1',
    name: id,
    mediaFileId: `${id}-media`,
    startTime,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    sourceType: 'video',
    naturalDuration: 2,
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

function timelineClip(clip: SerializableClip): TimelineClip {
  return {
    ...clip,
    file: new File([], `${clip.id}.mp4`),
    source: {
      type: 'video',
      mediaFileId: clip.mediaFileId,
      naturalDuration: clip.naturalDuration,
    },
  } as TimelineClip;
}

describe('transition composition service', () => {
  it('creates one exact-duration hidden comp and reuses it on the next ensure', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
    };

    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const attachments: string[] = [];

    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });
    const updateComposition = vi.fn((id: string, updates: Partial<Composition>) => {
      const index = compositions.findIndex((composition) => composition.id === id);
      compositions[index] = { ...compositions[index], ...updates };
    });

    const firstId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: ({ compositionId }) => {
        attachments.push(compositionId);
        timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, compositionId };
        timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, compositionId };
      },
    });

    const comp = compositions.find((composition) => composition.id === firstId)!;
    expect(firstId).toBe('transition-comp-1');
    expect(comp.transitionComp?.kind).toBe('transition-comp');
    expect(comp.transitionComp?.bodyStart).toBe(0);
    expect(comp.transitionComp?.bodyEnd).toBe(1);
    expect(comp.transitionComp?.paddingBefore).toBe(0);
    expect(comp.transitionComp?.paddingAfter).toBe(0);
    expect(comp.transitionComp?.templateType).toBe('crossfade');
    expect(comp.transitionComp?.templateVersion).toBe(2);
    expect(comp.timelineData?.duration).toBe(1);
    expect(comp.timelineData?.clips.filter((clip) => clip.id.startsWith('transition-comp:transition-1:outgoing'))).toHaveLength(2);
    expect(comp.timelineData?.clips.filter((clip) => clip.id.startsWith('transition-comp:transition-1:incoming'))).toHaveLength(2);
    expect(comp.timelineData?.clips.some((clip) => clip.transitionSourceHold === true)).toBe(true);

    const secondId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: ({ compositionId }) => attachments.push(compositionId),
    });

    expect(secondId).toBe(firstId);
    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(attachments).toEqual(['transition-comp-1', 'transition-comp-1']);

    timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, duration: 1.5 };
    timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, duration: 1.5 };

    ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: ({ compositionId }) => attachments.push(compositionId),
    });

    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(compositions.find((composition) => composition.id === firstId)?.timelineData?.duration).toBe(1.5);
  });

  it('refreshes linked source windows without replacing manual comp edits', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
    };

    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });
    const updateComposition = vi.fn((id: string, updates: Partial<Composition>) => {
      const index = compositions.findIndex((composition) => composition.id === id);
      compositions[index] = { ...compositions[index], ...updates };
    });
    const attachTransitionComposition = ({ compositionId }: { compositionId: string }) => {
      timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, compositionId };
      timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, compositionId };
    };

    const firstId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition,
    });
    const transitionComp = compositions.find((composition) => composition.id === firstId)!;
    transitionComp.timelineData = {
      ...transitionComp.timelineData!,
      clips: [
        ...transitionComp.timelineData!.clips,
        {
          id: 'manual-edit',
          trackId: 'manual-track',
          name: 'Manual Edit',
          mediaFileId: '',
          startTime: 0.25,
          duration: 0.5,
          inPoint: 0,
          outPoint: 0.5,
          sourceType: 'solid',
          solidColor: '#ff0000',
          transform: {
            opacity: 1,
            blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
          effects: [],
        },
      ],
    };

    serializableClips[0] = { ...serializableClips[0], inPoint: 0.4, outPoint: 2.4 };
    timelineClips[0] = {
      ...timelineClips[0],
      inPoint: 0.4,
      outPoint: 2.4,
      transitionOut: timelineClips[0].transitionOut,
    };

    ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition,
    });

    const updatedComp = compositions.find((composition) => composition.id === firstId)!;
    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(updatedComp.timelineData?.clips.some((clip) => clip.id === 'manual-edit')).toBe(true);
    expect(updatedComp.timelineData?.clips.find((clip) => clip.id === 'transition-comp:transition-1:outgoing')?.inPoint).toBeCloseTo(1.9);
  });

  it('reuses the attached comp after split remaps the parent clip id', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
    };

    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });
    const updateComposition = vi.fn((id: string, updates: Partial<Composition>) => {
      const index = compositions.findIndex((composition) => composition.id === id);
      compositions[index] = { ...compositions[index], ...updates };
    });
    const attachTransitionComposition = ({ compositionId }: { compositionId: string }) => {
      timelineClips[0].transitionOut = { ...timelineClips[0].transitionOut!, compositionId };
      timelineClips[1].transitionIn = { ...timelineClips[1].transitionIn!, compositionId };
    };

    const firstId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition,
    });
    const transitionComp = compositions.find((composition) => composition.id === firstId)!;
    transitionComp.timelineData = {
      ...transitionComp.timelineData!,
      clips: [
        ...transitionComp.timelineData!.clips,
        {
          id: 'manual-edit',
          trackId: 'manual-track',
          name: 'Manual Edit',
          mediaFileId: '',
          startTime: 0.25,
          duration: 0.5,
          inPoint: 0,
          outPoint: 0.5,
          sourceType: 'solid',
          solidColor: '#00ff00',
          transform: {
            opacity: 1,
            blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
          effects: [],
        },
      ],
    };

    const splitOut = { ...serializableClip('out-right', 0.5), duration: 1.5, inPoint: 0.5, outPoint: 2 };
    const splitIn = serializableClip('in', 2);
    const splitTimelineClips = [timelineClip(splitOut), timelineClip(splitIn)];
    splitTimelineClips[0].transitionOut = {
      ...timelineClips[0].transitionOut!,
      linkedClipId: 'in',
    };
    splitTimelineClips[1].transitionIn = {
      ...timelineClips[1].transitionIn!,
      linkedClipId: 'out-right',
    };

    const secondId = ensureTransitionCompositionForPair({
      outgoingClipId: 'out-right',
      transitionId: 'transition-1',
      timelineClips: splitTimelineClips,
      serializableClips: [splitOut, splitIn],
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition,
      attachTransitionComposition: vi.fn(),
    });

    const updatedComp = compositions.find((composition) => composition.id === firstId)!;
    expect(secondId).toBe(firstId);
    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(updatedComp.transitionComp?.parentOutgoingClipId).toBe('out-right');
    expect(updatedComp.timelineData?.clips.some((clip) => clip.id === 'manual-edit')).toBe(true);
  });

  it('does not reuse an attached composition id from another parent pair', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'in',
      compositionId: 'foreign-transition-comp',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'crossfade',
      duration: 1,
      linkedClipId: 'out',
      compositionId: 'foreign-transition-comp',
    };

    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [
      parent,
      {
        id: 'foreign-transition-comp',
        name: 'Foreign Transition',
        type: 'composition',
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 1,
        backgroundColor: '#000000',
        transitionComp: {
          kind: 'transition-comp',
          parentCompositionId: 'other-parent',
          parentTransitionId: 'transition-1',
          parentOutgoingClipId: 'out',
          parentIncomingClipId: 'in',
          linkedOutgoingClipId: 'foreign-out',
          linkedIncomingClipId: 'foreign-in',
          innerTransitionId: '',
          paddingBefore: 0,
          paddingAfter: 0,
          bodyStart: 0,
          bodyEnd: 1,
        },
        timelineData: { tracks: [], clips: [], duration: 1 },
      },
    ];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'new-transition-comp',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 3,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    expect(id).toBe('new-transition-comp');
    expect(createComposition).toHaveBeenCalledTimes(1);
  });

  it('materializes multi-panel transitions as source-rect clips on separate tracks', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'puzzle-push',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'puzzle-push',
      duration: 1,
      linkedClipId: 'out',
    };

    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    const comp = compositions.find((composition) => composition.id === id)!;
    const panelClips = comp.timelineData!.clips.filter((clip) => clip.sourceRect);
    const panelTrackIds = new Set(panelClips.map((clip) => clip.trackId));

    expect(panelClips.length).toBeGreaterThanOrEqual(16);
    expect(panelTrackIds.size).toBe(16);
    expect(panelClips.every((clip) => clip.keyframes?.some((keyframe) => keyframe.property === 'position.x'))).toBe(true);
  });

  it('materializes distortion transitions as animated effect clips', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'swirl',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'swirl',
      duration: 1,
      linkedClipId: 'out',
    };

    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    const comp = compositions.find((composition) => composition.id === id)!;
    const distortedClips = comp.timelineData!.clips.filter((clip) =>
      clip.effects?.some((effect) => effect.type === 'twirl')
    );

    expect(distortedClips).toHaveLength(4);
    expect(distortedClips.every((clip) => clip.transitionRender === undefined)).toBe(true);
    expect(distortedClips.every((clip) =>
      clip.keyframes?.some((keyframe) =>
        typeof keyframe.property === 'string' &&
        keyframe.property.startsWith('effect.') &&
        keyframe.property.endsWith('.amount')
      )
    )).toBe(true);
  });

  it('splits blend-window transitions instead of making blend mode global', () => {
    const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
    const timelineClips = serializableClips.map(timelineClip);
    timelineClips[0].transitionOut = {
      id: 'transition-1',
      type: 'additive-dissolve',
      duration: 1,
      linkedClipId: 'in',
    };
    timelineClips[1].transitionIn = {
      id: 'transition-1',
      type: 'additive-dissolve',
      duration: 1,
      linkedClipId: 'out',
    };

    const parent: Composition = {
      id: 'parent',
      name: 'Parent',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: serializableClips, duration: 5 },
    };
    const compositions: Composition[] = [parent];
    const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
      const comp = {
        id: 'transition-comp-1',
        name,
        type: 'composition' as const,
        parentId: null,
        createdAt: 2,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: settings?.duration ?? 1,
        backgroundColor: '#000000',
        timelineData: settings?.timelineData,
        transitionComp: settings?.transitionComp,
      };
      compositions.push(comp);
      return comp;
    });

    const id = ensureTransitionCompositionForPair({
      outgoingClipId: 'out',
      transitionId: 'transition-1',
      timelineClips,
      serializableClips,
      parentComposition: parent,
      compositions,
      createComposition,
      updateComposition: vi.fn(),
      attachTransitionComposition: vi.fn(),
    });

    const comp = compositions.find((composition) => composition.id === id)!;
    const incomingClips = comp.timelineData!.clips.filter((clip) =>
      clip.id.startsWith('transition-comp:transition-1:incoming')
    );

    expect(incomingClips.some((clip) => clip.transform.blendMode === 'add')).toBe(true);
    expect(incomingClips.some((clip) => clip.transform.blendMode === 'normal')).toBe(true);
  });

  it('materializes every runtime transition type without inner transition metadata', () => {
    const failures: string[] = [];

    for (const definition of getAllTransitions()) {
      const serializableClips = [serializableClip('out', 0), serializableClip('in', 2)];
      const timelineClips = serializableClips.map(timelineClip);
      timelineClips[0].transitionOut = {
        id: 'transition-1',
        type: definition.id,
        duration: 1,
        linkedClipId: 'in',
      };
      timelineClips[1].transitionIn = {
        id: 'transition-1',
        type: definition.id,
        duration: 1,
        linkedClipId: 'out',
      };
      const parent: Composition = {
        id: 'parent',
        name: 'Parent',
        type: 'composition',
        parentId: null,
        createdAt: 1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 5,
        backgroundColor: '#000000',
        timelineData: { tracks: [], clips: serializableClips, duration: 5 },
      };
      const compositions: Composition[] = [parent];
      const createComposition = vi.fn((name: string, settings?: Partial<Composition>): Composition => {
        const comp = {
          id: `transition-comp-${definition.id}`,
          name,
          type: 'composition' as const,
          parentId: null,
          createdAt: 2,
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: settings?.duration ?? 1,
          backgroundColor: '#000000',
          timelineData: settings?.timelineData,
          transitionComp: settings?.transitionComp,
        };
        compositions.push(comp);
        return comp;
      });

      try {
        const id = ensureTransitionCompositionForPair({
          outgoingClipId: 'out',
          transitionId: 'transition-1',
          timelineClips,
          serializableClips,
          parentComposition: parent,
          compositions,
          createComposition,
          updateComposition: vi.fn(),
          attachTransitionComposition: vi.fn(),
        });
        const comp = compositions.find((composition) => composition.id === id);
        expect(comp?.timelineData?.duration).toBe(1);
        expect(comp?.timelineData?.clips.length).toBeGreaterThan(0);
        expect(comp?.timelineData?.clips.some((clip) => clip.transitionIn || clip.transitionOut)).toBe(false);
      } catch (error) {
        failures.push(`${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

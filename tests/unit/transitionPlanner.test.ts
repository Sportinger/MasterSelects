import { describe, expect, it } from 'vitest';

import {
  createTransitionSourceClip,
  findActiveTransitionPlanForTrack,
  planTransition,
} from '../../src/stores/timeline/editOperations/transitionPlanner';
import { createMockClip } from '../helpers/mockData';

function createTransitionPair(overrides: {
  trackId?: string;
  startTime?: number;
  duration?: number;
} = {}) {
  const trackId = overrides.trackId ?? 'track-1';
  const startTime = overrides.startTime ?? 0;
  const duration = overrides.duration ?? 10;
  const outgoingClip = createMockClip({
    id: 'outgoing',
    trackId,
    startTime,
    duration,
    transitionOut: {
      id: 'transition-1',
      type: 'crossfade',
      duration: 2,
      linkedClipId: 'incoming',
    },
  });
  const incomingClip = createMockClip({
    id: 'incoming',
    trackId,
    startTime: startTime + duration,
    duration: 8,
    transitionIn: {
      id: 'transition-1',
      type: 'crossfade',
      duration: 2,
      linkedClipId: 'outgoing',
    },
  });
  return { outgoingClip, incomingClip };
}

describe('transitionPlanner', () => {
  it('places codec datamosh after the cut for its full mosh duration', () => {
    const outgoingClip = createMockClip({ id: 'outgoing', startTime: 0, duration: 10 });
    const incomingClip = createMockClip({ id: 'incoming', startTime: 10, duration: 8 });

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'datamosh',
      requestedDuration: 2,
      placement: 'center',
      junctionTime: 10,
    });

    expect(plan).toMatchObject({
      placement: 'start-at-cut',
      bodyStart: 10,
      bodyEnd: 12,
      resolvedDuration: 2,
    });
  });

  it('plans first-pass end-at-cut as a virtual handle-based transition', () => {
    const outgoingClip = createMockClip({
      id: 'outgoing',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 12 },
    });
    const incomingClip = createMockClip({
      id: 'incoming',
      startTime: 10,
      duration: 8,
      inPoint: 0.5,
      outPoint: 8.5,
      source: { type: 'video', naturalDuration: 9 },
    });

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'wipe-left',
      requestedDuration: 2,
      placement: 'end-at-cut',
      edgePolicy: 'hold',
      junctionTime: 10,
    });

    expect(plan).toMatchObject({
      transitionType: 'wipe-left',
      placement: 'end-at-cut',
      resolvedDuration: 2,
      bodyStart: 8,
      bodyEnd: 10,
      timingChanges: [],
    });
    expect(plan?.incoming.handleNeeded).toBe(2);
    expect(plan?.incoming.realHandleDuration).toBe(0.5);
    expect(plan?.incoming.holdDuration).toBe(1.5);
    expect(plan?.incoming.coverage).toEqual([
      expect.objectContaining({
        kind: 'hold',
        startTime: 8,
        endTime: 9.5,
        sourceStart: 0,
        sourceEnd: 0,
        holdFrame: 'first-frame',
      }),
      expect.objectContaining({
        kind: 'real-handle',
        startTime: 9.5,
        endTime: 10,
        sourceStart: 0,
        sourceEnd: 0.5,
      }),
    ]);
  });

  it('blocks insufficient handles when policy requires real media', () => {
    const outgoingClip = createMockClip({
      id: 'outgoing',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
    });
    const incomingClip = createMockClip({
      id: 'incoming',
      startTime: 10,
      duration: 8,
      inPoint: 0.25,
      outPoint: 8.25,
      source: { type: 'video', naturalDuration: 8.25 },
    });

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'crossfade',
      requestedDuration: 1,
      placement: 'end-at-cut',
      edgePolicy: 'require-handles',
      junctionTime: 10,
    });

    expect(plan?.blockedReason).toMatchObject({
      code: 'require-handles',
    });
    expect(plan?.incoming.holdDuration).toBe(0.75);
  });

  it('plans center placement with incoming left and outgoing right handles', () => {
    const outgoingClip = createMockClip({
      id: 'outgoing',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10.75 },
    });
    const incomingClip = createMockClip({
      id: 'incoming',
      startTime: 10,
      duration: 8,
      inPoint: 0.75,
      outPoint: 8.75,
      source: { type: 'video', naturalDuration: 8.75 },
    });

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'crossfade',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    });

    expect(plan).toMatchObject({
      bodyStart: 9,
      bodyEnd: 11,
    });
    expect(plan?.incoming.handleNeeded).toBe(1);
    expect(plan?.incoming.realHandleDuration).toBe(0.75);
    expect(plan?.incoming.holdDuration).toBe(0.25);
    expect(plan?.outgoing.handleNeeded).toBe(1);
    expect(plan?.outgoing.realHandleDuration).toBe(0.75);
    expect(plan?.outgoing.holdDuration).toBe(0.25);
  });

  it('keeps virtual real-handle source clips stable across playback frames', () => {
    const outgoingClip = createMockClip({
      id: 'outgoing',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
    });
    const incomingClip = createMockClip({
      id: 'incoming',
      startTime: 10,
      duration: 8,
      inPoint: 0.75,
      outPoint: 8.75,
      source: { type: 'video', naturalDuration: 8.75 },
    });

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'crossfade',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    });

    expect(plan).not.toBeNull();

    const holdClip = createTransitionSourceClip(incomingClip, plan!.incoming, 9.1);
    expect(holdClip.startTime).toBe(9);
    expect(holdClip.inPoint).toBe(0);
    expect(holdClip.outPoint).toBe(0);

    const realClipA = createTransitionSourceClip(incomingClip, plan!.incoming, 9.5);
    const realClipB = createTransitionSourceClip(incomingClip, plan!.incoming, 9.75);
    expect(realClipA.startTime).toBe(9.25);
    expect(realClipA.inPoint).toBe(0);
    expect(realClipA.outPoint).toBe(0.75);
    expect(realClipB.startTime).toBe(realClipA.startTime);
    expect(realClipB.inPoint).toBe(realClipA.inPoint);
    expect(realClipB.outPoint).toBe(realClipA.outPoint);
  });

  it('allows long transitions beyond clip bodies by holding boundary frames', () => {
    const outgoingClip = createMockClip({
      id: 'outgoing',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'video', naturalDuration: 4 },
    });
    const incomingClip = createMockClip({
      id: 'incoming',
      startTime: 4,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video', naturalDuration: 3 },
    });

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'crossfade',
      requestedDuration: 12,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 4,
    });

    expect(plan).toMatchObject({
      resolvedDuration: 12,
      bodyStart: -2,
      bodyEnd: 10,
    });
    expect(plan?.outgoing.coverage).toEqual([
      expect.objectContaining({
        kind: 'hold',
        startTime: -2,
        endTime: 0,
        sourceStart: 0,
        holdFrame: 'first-frame',
      }),
      expect.objectContaining({
        kind: 'visible',
        startTime: 0,
        endTime: 4,
        sourceStart: 0,
        sourceEnd: 4,
      }),
      expect.objectContaining({
        kind: 'hold',
        startTime: 4,
        endTime: 10,
        holdFrame: 'last-frame',
      }),
    ]);
    expect(plan?.outgoing.coverage[2]?.sourceStart).toBeCloseTo(4 - (1 / 120));
    expect(plan?.incoming.coverage).toEqual([
      expect.objectContaining({
        kind: 'hold',
        startTime: -2,
        endTime: 4,
        sourceStart: 0,
        holdFrame: 'first-frame',
      }),
      expect.objectContaining({
        kind: 'visible',
        startTime: 4,
        endTime: 7,
        sourceStart: 0,
        sourceEnd: 3,
      }),
      expect.objectContaining({
        kind: 'hold',
        startTime: 7,
        endTime: 10,
        holdFrame: 'last-frame',
      }),
    ]);
    expect(plan?.incoming.coverage[2]?.sourceStart).toBeCloseTo(3 - (1 / 120));
  });

  it('refuses planned transition ids that are not runtime-enabled', () => {
    const outgoingClip = createMockClip({
      id: 'outgoing',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 12 },
    });
    const incomingClip = createMockClip({
      id: 'incoming',
      startTime: 10,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      source: { type: 'video', naturalDuration: 10 },
    });

    expect(planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'page-peel',
      requestedDuration: 1,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    })).toBeNull();
  });

  it('invalidates transition candidates when clips are added or removed', () => {
    const { outgoingClip, incomingClip } = createTransitionPair();
    const withoutTransition = [incomingClip];

    expect(findActiveTransitionPlanForTrack({
      clips: withoutTransition,
      trackId: 'track-1',
      time: 9.5,
    })).toBeNull();

    const withTransition = [...withoutTransition, outgoingClip];
    expect(findActiveTransitionPlanForTrack({
      clips: withTransition,
      trackId: 'track-1',
      time: 9.5,
    })?.outgoingClip.id).toBe('outgoing');

    const removedTransition = withTransition.filter(clip => clip.id !== 'outgoing');
    expect(findActiveTransitionPlanForTrack({
      clips: removedTransition,
      trackId: 'track-1',
      time: 9.5,
    })).toBeNull();
  });

  it('invalidates sorted candidates after a clip timing move', () => {
    const initial = createTransitionPair();
    const initialClips = [initial.outgoingClip, initial.incomingClip];

    expect(findActiveTransitionPlanForTrack({
      clips: initialClips,
      trackId: 'track-1',
      time: 9.5,
    })?.outgoingClip.id).toBe('outgoing');

    const moved = createTransitionPair({ startTime: 20 });
    const movedClips = [moved.incomingClip, moved.outgoingClip];
    expect(findActiveTransitionPlanForTrack({
      clips: movedClips,
      trackId: 'track-1',
      time: 9.5,
    })).toBeNull();
    expect(findActiveTransitionPlanForTrack({
      clips: movedClips,
      trackId: 'track-1',
      time: 29.5,
    })?.outgoingClip.id).toBe('outgoing');
  });

  it('uses an edited clip duration after clip-array replacement', () => {
    const initial = createTransitionPair();
    const initialClips = [initial.outgoingClip, initial.incomingClip];

    expect(findActiveTransitionPlanForTrack({
      clips: initialClips,
      trackId: 'track-1',
      time: 9.5,
    })?.plan.junctionTime).toBe(10);

    const shortened = createTransitionPair({ duration: 6 });
    const shortenedClips = [shortened.outgoingClip, shortened.incomingClip];
    expect(findActiveTransitionPlanForTrack({
      clips: shortenedClips,
      trackId: 'track-1',
      time: 9.5,
    })).toBeNull();
    expect(findActiveTransitionPlanForTrack({
      clips: shortenedClips,
      trackId: 'track-1',
      time: 5.5,
    })?.plan.junctionTime).toBe(6);
  });

  it('indexes a 1682-clip no-transition timeline only once per clip-array identity', () => {
    let transitionReads = 0;
    const clips = Array.from({ length: 1682 }, (_, index) => new Proxy(
      createMockClip({
        id: `clip-${index}`,
        trackId: `track-${index}`,
        startTime: index,
      }),
      {
        get(target, property, receiver) {
          if (property === 'transitionOut') transitionReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    ));

    expect(findActiveTransitionPlanForTrack({
      clips,
      trackId: 'track-0',
      time: 0,
    })).toBeNull();
    expect(transitionReads).toBe(1682);

    for (let index = 0; index < 500; index += 1) {
      expect(findActiveTransitionPlanForTrack({
        clips,
        trackId: `track-${index}`,
        time: index,
      })).toBeNull();
    }
    expect(transitionReads).toBe(1682);
  });
});

import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  findActiveTransitionPlanForTrack: vi.fn(),
  getVisibleVideoTrackTransitionPlansInWindow: vi.fn(),
  resolveTransitionCompositionRuntime: vi.fn(),
}));

vi.mock('../../src/stores/timeline/editOperations/transitionPlanner', () => ({
  DEFAULT_TRANSITION_PLACEMENT: 'center',
  findActiveTransitionPlanForTrack: hoisted.findActiveTransitionPlanForTrack,
}));

vi.mock('../../src/services/layerBuilder/layerBuilderTransitionComposition', () => ({
  resolveTransitionCompositionRuntime: hoisted.resolveTransitionCompositionRuntime,
}));

vi.mock('../../src/services/layerBuilder/videoSyncTransitionQueries', () => ({
  getVisibleVideoTrackTransitionPlansInWindow: hoisted.getVisibleVideoTrackTransitionPlansInWindow,
}));

import {
  getUpcomingBakedTransitionVideoWarmupTargets,
  syncActiveTransitionCompositionVideos,
} from '../../src/services/layerBuilder/videoSyncTransitionCompositionCoordinator';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { TimelineClip } from '../../src/types/timeline';

describe('transition composition video sync', () => {
  it('returns the first baked video frame before an upcoming datamosh transition', () => {
    const activeTransition = {
      plan: { bodyStart: 3, bodyEnd: 4 },
      outgoingClip: { id: 'outgoing' },
      incomingClip: { id: 'incoming' },
    };
    const bakedClip = {
      id: 'transition-comp:mosh:datamosh',
      trackId: 'baked-track',
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      source: { type: 'video' },
    } as TimelineClip;
    hoisted.getVisibleVideoTrackTransitionPlansInWindow.mockReturnValue([activeTransition]);
    hoisted.resolveTransitionCompositionRuntime.mockReturnValue({
      composition: { transitionComp: { templateType: 'datamosh-baked' } },
      compositionTime: 0,
      nestedTimeline: {
        clips: [bakedClip],
        tracks: [{ id: 'baked-track', type: 'video', visible: true }],
      },
    });
    const ctx = {
      playheadPosition: 2,
    } as unknown as FrameContext;

    const targets = getUpcomingBakedTransitionVideoWarmupTargets({
      ctx,
      windowStart: 2,
      windowEnd: 3.5,
    });

    expect(hoisted.resolveTransitionCompositionRuntime).toHaveBeenCalledWith(
      activeTransition,
      expect.objectContaining({ playheadPosition: 3 }),
    );
    expect(targets).toEqual([{ clip: bakedClip, sourceTime: 0 }]);
  });

  it('forwards the active materialized transition clip with its local time', () => {
    const activeTransition = { plan: { bodyStart: 3, bodyEnd: 4 } };
    const syntheticClip = { id: 'transition-comp-parent:mosh' } as TimelineClip;
    hoisted.findActiveTransitionPlanForTrack.mockReturnValue(activeTransition);
    hoisted.resolveTransitionCompositionRuntime.mockReturnValue({
      syntheticClip,
      compositionTime: 0.5,
    });
    const syncNestedComposition = vi.fn();
    const ctx = {
      playheadPosition: 3.5,
      clips: [],
      videoTracks: [{ id: 'video-1' }, { id: 'hidden-video' }],
      visibleVideoTrackIds: new Set(['video-1']),
      mediaFileById: new Map(),
    } as unknown as FrameContext;

    syncActiveTransitionCompositionVideos({ ctx, syncNestedComposition });

    expect(hoisted.findActiveTransitionPlanForTrack).toHaveBeenCalledTimes(1);
    expect(hoisted.resolveTransitionCompositionRuntime).toHaveBeenCalledWith(activeTransition, ctx);
    expect(syncNestedComposition).toHaveBeenCalledWith(syntheticClip, 0.5);
  });
});

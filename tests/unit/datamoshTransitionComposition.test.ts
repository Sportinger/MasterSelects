import { describe, expect, it } from 'vitest';

import { buildBakedDatamoshTimelineData } from '../../src/services/timeline/datamoshTransitionComposition';
import { hydrateTransitionCompositionTimeline } from '../../src/services/layerBuilder/layerBuilderTransitionComposition';
import { DATAMOSH_BAKE_FORMAT } from '../../src/transitions/datamosh';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { ActiveTransitionPlan } from '../../src/stores/timeline/editOperations/transitionPlanner';
import type { TimelineTransition } from '../../src/types/timelineCore';
import { createMockClip } from '../helpers/mockData';

function transition(params: TimelineTransition['params'] = {}): TimelineTransition {
  return {
    id: 'mosh-1',
    type: 'datamosh',
    duration: 2,
    linkedClipId: 'incoming',
    params: {
      bitrateMbps: 2,
      ...params,
    },
  };
}

describe('baked datamosh transition composition', () => {
  const outgoingClip = createMockClip({ id: 'outgoing', duration: 4 });
  const incomingClip = createMockClip({ id: 'incoming', startTime: 4, duration: 5 });

  it('materializes the current codec artifact as the visible transition source', () => {
    const result = buildBakedDatamoshTimelineData({
      outgoingClip,
      incomingClip,
      transition: transition({
        bakedMediaFileId: 'baked-media',
        bakedDuration: 2,
        bakedBitrateMbps: 2,
        bakedFormat: DATAMOSH_BAKE_FORMAT,
      }),
    });

    expect(result?.link).toMatchObject({
      templateType: 'datamosh-baked',
      bodyStart: 0,
      bodyEnd: 2,
      materialized: true,
    });
    expect(result?.timelineData.clips).toContainEqual(expect.objectContaining({
      name: 'Codec Datamosh',
      mediaFileId: 'baked-media',
      sourceType: 'video',
      duration: 2,
    }));
  });

  it('rejects missing and stale artifacts so the clean fallback is rendered', () => {
    expect(buildBakedDatamoshTimelineData({
      outgoingClip,
      incomingClip,
      transition: transition(),
    })).toBeNull();
    expect(buildBakedDatamoshTimelineData({
      outgoingClip,
      incomingClip,
      transition: transition({
        bakedMediaFileId: 'old-duration',
        bakedDuration: 1,
        bakedBitrateMbps: 2,
        bakedFormat: DATAMOSH_BAKE_FORMAT,
      }),
    })).toBeNull();
    expect(buildBakedDatamoshTimelineData({
      outgoingClip,
      incomingClip,
      transition: transition({
        bakedMediaFileId: 'old-bitrate',
        bakedDuration: 2,
        bakedBitrateMbps: 4,
        bakedFormat: DATAMOSH_BAKE_FORMAT,
      }),
    })).toBeNull();
  });

  it('restores the capped bake to the full transition composition footprint', () => {
    const result = buildBakedDatamoshTimelineData({
      outgoingClip,
      incomingClip,
      transition: transition({
        bakedMediaFileId: 'baked-media',
        bakedDuration: 2,
        bakedBitrateMbps: 2,
        bakedFormat: DATAMOSH_BAKE_FORMAT,
      }),
    });
    expect(result).not.toBeNull();
    const composition = {
      id: 'transition-composition',
      name: 'Datamosh transition',
      type: 'composition',
      parentId: 'parent-composition',
      createdAt: 0,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 2,
      backgroundColor: '#000000',
      timelineData: result!.timelineData,
      transitionComp: {
        ...result!.link,
        parentCompositionId: 'parent-composition',
      },
    } as Composition;
    const hydrated = hydrateTransitionCompositionTimeline({
      composition,
      activeTransition: {
        outgoingClip,
        incomingClip,
      } as ActiveTransitionPlan,
      mediaFileById: new Map([['baked-media', { width: 640, height: 360 }]]),
    });

    expect(hydrated.clips[0].transform.scale).toMatchObject({ x: 3, y: 3 });
  });
});

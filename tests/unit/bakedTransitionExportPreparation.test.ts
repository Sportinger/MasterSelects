import { describe, expect, it } from 'vitest';

import { collectBakedTransitionPreparationClips } from '../../src/engine/export/clipPreparation/bakedTransitionClips';
import { buildBakedDatamoshTimelineData } from '../../src/services/timeline/datamoshTransitionComposition';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import type { TimelineTransition } from '../../src/types/timelineCore';
import { DATAMOSH_BAKE_FORMAT } from '../../src/transitions/datamosh';
import { createMockClip } from '../helpers/mockData';

describe('baked transition export preparation', () => {
  it('materializes the baked Datamosh video as a nested export decoder source', () => {
    const transition: TimelineTransition = {
      id: 'mosh-export',
      type: 'datamosh',
      duration: 1,
      linkedClipId: 'incoming',
      compositionId: 'mosh-composition',
      params: {
        bitrateMbps: 2,
        bakedBitrateMbps: 2,
        bakedDuration: 1,
        bakedFormat: DATAMOSH_BAKE_FORMAT,
        bakedMediaFileId: 'baked-media',
      },
    };
    const outgoing = createMockClip({
      id: 'outgoing',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      transitionOut: transition,
    });
    const incoming = createMockClip({
      id: 'incoming',
      trackId: 'video-1',
      startTime: 3,
      duration: 4,
    });
    const materialized = buildBakedDatamoshTimelineData({
      outgoingClip: outgoing,
      incomingClip: incoming,
      transition,
    });
    expect(materialized).not.toBeNull();

    const composition = {
      id: 'mosh-composition',
      name: 'Datamosh transition',
      type: 'composition',
      parentId: 'main-composition',
      createdAt: 0,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 1,
      backgroundColor: '#000000',
      timelineData: materialized!.timelineData,
      transitionComp: {
        ...materialized!.link,
        parentCompositionId: 'main-composition',
      },
    } as Composition;
    const bakedFile = new File(['mosh'], 'mosh.mp4', { type: 'video/mp4' });
    const mediaFile = {
      id: 'baked-media',
      name: 'mosh.mp4',
      file: bakedFile,
      width: 640,
      height: 360,
      duration: 1,
    } as MediaFile;
    const tracks = [{ id: 'video-1', name: 'Video 1', type: 'video', visible: true }] as TimelineTrack[];

    const [preparationClip] = collectBakedTransitionPreparationClips({
      clips: [outgoing, incoming] as TimelineClip[],
      tracks,
      mediaFiles: [mediaFile],
      mediaCompositions: [composition],
      rangeStart: 0,
      rangeEnd: 7,
    });

    expect(preparationClip).toMatchObject({
      isComposition: true,
      startTime: 3,
      duration: 1,
    });
    expect(preparationClip.nestedClips).toContainEqual(expect.objectContaining({
      id: 'transition-comp:mosh-export:datamosh',
      mediaFileId: 'baked-media',
      file: bakedFile,
      source: expect.objectContaining({ type: 'video', mediaFileId: 'baked-media' }),
      transform: expect.objectContaining({ scale: expect.objectContaining({ x: 3, y: 3 }) }),
    }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCreateEditableTitleStack } from '../../src/services/aiTools/handlers/editableTitleStack';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import { getToolPolicy } from '../../src/services/aiTools/policy/registry';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [
      {
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      },
      {
        id: 'video-locked',
        name: 'Locked Video',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
        locked: true,
      },
    ],
    playheadPosition: 3,
    clipKeyframes: new Map(),
  });
}

describe('createEditableTitleStack', () => {
  beforeEach(() => {
    useMediaStore.setState(initialMediaState);
    const composition: Composition = {
      id: 'title-stack-composition',
      name: 'Title Stack Test',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 30,
      backgroundColor: '#000000',
    };
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      compositions: [composition],
      activeCompositionId: composition.id,
      getActiveComposition: () => composition,
    } as ReturnType<typeof useMediaStore.getState>);
    resetTimeline();
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
  });

  it('is registered as a medium-risk modifying chat tool', () => {
    expect(getRegisteredToolHandlerNames()).toContain('createEditableTitleStack');
    expect(MODIFYING_TOOLS.has('createEditableTitleStack')).toBe(true);
    expect(getToolPolicy('createEditableTitleStack')).toMatchObject({
      readOnly: false,
      riskLevel: 'medium',
      requiresConfirmation: false,
    });
  });

  it('allocates collision-free topmost-first tracks and converts box coordinates', async () => {
    const result = await handleCreateEditableTitleStack({
      duration: 5,
      rows: [
        {
          text: 'HOOKS FOR YOUR VIDEOS',
          box: { x: 500, y: 120, width: 920, height: 110 },
          backplate: { color: '#000000', opacity: 1, paddingX: 30, paddingY: 10, cornerRadius: 18 },
        },
        {
          text: '8 YOU CAN USE IMMEDIATELY',
          box: { x: 480, y: 250, width: 960, height: 100 },
          backplate: { color: '#ffffff', opacity: 1, paddingX: 24, paddingY: 8, cornerRadius: 12 },
          textStyle: { color: '#ff00ff', fontSize: 58 },
        },
      ],
    }, useTimelineStore.getState());

    expect(result.success, JSON.stringify(result)).toBe(true);
    const data = result.data as {
      composition: { width: number; height: number };
      rows: Array<{
        textClipId: string;
        textTrackId: string;
        backplateClipId: string;
        backplateTrackId: string;
        backplateCenter: { x: number; y: number };
      }>;
      createdTrackIds: string[];
      trackOrder: string;
    };
    expect(data.trackOrder).toBe('TOPMOST-FIRST');
    expect(data.createdTrackIds).toHaveLength(3);
    expect(useTimelineStore.getState().clips).toHaveLength(4);

    const trackOrder = new Map(useTimelineStore.getState().tracks.map((track, index) => [track.id, index]));
    for (const row of data.rows) {
      expect(trackOrder.get(row.textTrackId)).toBeLessThan(trackOrder.get(row.backplateTrackId)!);
    }
    const first = data.rows[0];
    expect(first.backplateCenter).toEqual({
      x: 500 + 920 / 2 - data.composition.width / 2,
      y: 120 + 110 / 2 - data.composition.height / 2,
    });
    const firstPlate = useTimelineStore.getState().clips.find((clip) => clip.id === first.backplateClipId)!;
    expect(firstPlate.transform.position).toMatchObject({
      x: first.backplateCenter.x / (data.composition.width / 2),
      y: first.backplateCenter.y / (data.composition.height / 2),
    });
    expect(firstPlate.motion?.shape?.size).toEqual({ w: 980, h: 130 });

    const secondText = useTimelineStore.getState().clips.find(
      (clip) => clip.id === data.rows[1].textClipId,
    )!;
    expect(secondText.textProperties).toMatchObject({
      text: '8 YOU CAN USE IMMEDIATELY',
      color: '#ff00ff',
      fontSize: 58,
    });
  });

  it('rejects invalid explicit tracks before creating any layer', async () => {
    const result = await handleCreateEditableTitleStack({
      trackIds: ['video-1', 'video-locked'],
      rows: [{
        text: 'No partial mutation',
        box: { x: 100, y: 100, width: 600, height: 100 },
      }],
    }, useTimelineStore.getState());

    expect(result.success).toBe(false);
    expect(result.error).toContain('locked');
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(useTimelineStore.getState().tracks).toHaveLength(2);
  });
});

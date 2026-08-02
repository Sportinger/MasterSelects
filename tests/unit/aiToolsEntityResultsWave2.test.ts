import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleReorderClips } from '../../src/services/aiTools/handlers/clips';
import { handleAddMarker, handleRemoveMarker } from '../../src/services/aiTools/handlers/playback/basic';
import { handleCreateTrack } from '../../src/services/aiTools/handlers/tracks';
import type { ToolResult } from '../../src/services/aiTools/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

type EntityKind = 'clip' | 'marker' | 'track' | 'transition';

interface MutationResultData {
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  entities: {
    created: Array<{ kind: EntityKind; id: string }>;
    updated: Array<{ kind: EntityKind; id: string }>;
    deleted: Array<{ kind: EntityKind; id: string }>;
  };
}

describe('AI tool entity results wave 2', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      markers: [],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      duration: 20,
      isExporting: false,
    });
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('reports marker creation and deletion in a round trip', async () => {
    const addResult = await handleAddMarker(
      { time: 4, label: 'Chapter' },
      useTimelineStore.getState(),
    );
    const addData = getMutationResultData(addResult) as MutationResultData & { markerId: string };

    expect(addData.entities.created).toEqual([
      { kind: 'marker', id: addData.markerId },
    ]);
    expect(addData.entities.updated).toHaveLength(0);
    expect(addData.entities.deleted).toHaveLength(0);
    expect(addData.stateRevisionAfter).toBeGreaterThan(addData.stateRevisionBefore);

    const removeResult = await handleRemoveMarker(
      { markerId: addData.markerId },
      useTimelineStore.getState(),
    );
    const removeData = getMutationResultData(removeResult);

    expect(removeData.entities.created).toHaveLength(0);
    expect(removeData.entities.updated).toHaveLength(0);
    expect(removeData.entities.deleted).toEqual([
      { kind: 'marker', id: addData.markerId },
    ]);
    expect(removeData.stateRevisionAfter).toBeGreaterThan(removeData.stateRevisionBefore);
  });

  it('reports the track reference created by createTrack', async () => {
    const result = await handleCreateTrack(
      { type: 'video' },
      useTimelineStore.getState(),
    );
    const data = getMutationResultData(result) as MutationResultData & { trackId: string };

    expect(data.entities.created).toContainEqual({ kind: 'track', id: data.trackId });
    expect(data.entities.updated).toHaveLength(0);
    expect(data.entities.deleted).toHaveLength(0);
    expect(data.stateRevisionAfter).toBeGreaterThan(data.stateRevisionBefore);
  });

  it('reports updated clip refs and an increasing revision when clips are reordered', async () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-track', type: 'video' })],
      clips: [
        createMockClip({
          id: 'clip-a',
          trackId: 'video-track',
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
        }),
        createMockClip({
          id: 'clip-b',
          trackId: 'video-track',
          startTime: 2,
          duration: 3,
          inPoint: 0,
          outPoint: 3,
        }),
      ],
    });

    const result = await handleReorderClips(
      { clipIds: ['clip-b', 'clip-a'], startTime: 5, withLinked: false },
      useTimelineStore.getState(),
    );
    const data = getMutationResultData(result);

    expect(data.entities.created).toHaveLength(0);
    expect(data.entities.updated.length).toBeGreaterThan(0);
    expect(data.entities.updated.every((entity) => entity.kind === 'clip')).toBe(true);
    expect(data.entities.deleted).toHaveLength(0);
    expect(data.stateRevisionAfter).toBeGreaterThan(data.stateRevisionBefore);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === 'clip-b')?.startTime).toBe(5);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === 'clip-a')?.startTime).toBe(8);
  });
});

function getMutationResultData(result: ToolResult): MutationResultData {
  expect(result.success).toBe(true);
  return result.data as MutationResultData;
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vi } from 'vitest';
import { handleDeleteClip } from '../../src/services/aiTools/handlers/clips/delete';
import { handleAddEffect } from '../../src/services/aiTools/handlers/effects';
import { handleAddKeyframe } from '../../src/services/aiTools/handlers/keyframes';
import { handleUpdateMask } from '../../src/services/aiTools/handlers/masks';
import { handleSetTransform } from '../../src/services/aiTools/handlers/transform';
import type { ToolResult } from '../../src/services/aiTools/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { ClipMask } from '../../src/types/masks';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

type EntityKind = 'clip' | 'effect' | 'keyframe' | 'mask' | 'transform';

interface MutationResultData {
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  entities: {
    created: Array<{ kind: EntityKind; id: string }>;
    updated: Array<{ kind: EntityKind; id: string }>;
    deleted: Array<{ kind: EntityKind; id: string }>;
  };
}

describe('AI tool mutation envelopes packet A', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', name: 'Composition 1', width: 1920, height: 1080 } as never],
    } as ReturnType<typeof useMediaStore.getState>);
    seedTimeline();
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
  });

  it('reports both video and linked-audio deletions', async () => {
    const result = await handleDeleteClip(
      { clipId: 'video-clip', withLinked: true },
      useTimelineStore.getState(),
    );
    const data = getMutationResultData(result);

    expect(data.entities.deleted).toEqual(expect.arrayContaining([
      { kind: 'clip', id: 'video-clip' },
      { kind: 'clip', id: 'audio-clip' },
    ]));
    expectIncreasingRevision(data);
  });

  it('reports the effect created by addEffect', async () => {
    const result = await handleAddEffect(
      { clipId: 'video-clip', effectType: 'brightness' },
      useTimelineStore.getState(),
    );
    const data = getMutationResultData(result) as MutationResultData & { effectId: string };

    expect(data.entities.created).toContainEqual({ kind: 'effect', id: data.effectId });
    expectIncreasingRevision(data);
  });

  it('reports the mask updated by updateMask', async () => {
    const result = await handleUpdateMask(
      { clipId: 'video-clip', maskId: 'mask-1', opacity: 0.5 },
      useTimelineStore.getState(),
    );
    const data = getMutationResultData(result);

    expect(data.entities.updated).toContainEqual({ kind: 'mask', id: 'mask-1' });
    expectIncreasingRevision(data);
  });

  it('reports the keyframe created by addKeyframe', async () => {
    const result = await handleAddKeyframe(
      { clipId: 'video-clip', property: 'opacity', value: 0.5, time: 1 },
      useTimelineStore.getState(),
    );
    const data = getMutationResultData(result) as MutationResultData & { keyframeId: string };

    expect(data.entities.created).toContainEqual({ kind: 'keyframe', id: data.keyframeId });
    expectIncreasingRevision(data);
  });

  it('reports the owning clip transform updated by setTransform', async () => {
    const result = await handleSetTransform(
      { clipId: 'video-clip', x: 192 },
      useTimelineStore.getState(),
    );
    const data = getMutationResultData(result);

    expect(data.entities.updated).toContainEqual({ kind: 'transform', id: 'video-clip' });
    expectIncreasingRevision(data);
  });
});

function seedTimeline(): void {
  const mask: ClipMask = {
    id: 'mask-1',
    name: 'Mask 1',
    vertices: [],
    closed: false,
    opacity: 1,
    feather: 0,
    featherQuality: 50,
    inverted: false,
    mode: 'add',
    expanded: true,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
  };

  useTimelineStore.setState({
    tracks: [
      createMockTrack({ id: 'video-track', type: 'video' }),
      createMockTrack({ id: 'audio-track', type: 'audio' }),
    ],
    clips: [
      createMockClip({
        id: 'video-clip',
        trackId: 'video-track',
        linkedClipId: 'audio-clip',
        source: { type: 'video' },
        masks: [mask],
      }),
      createMockClip({
        id: 'audio-clip',
        trackId: 'audio-track',
        linkedClipId: 'video-clip',
        source: { type: 'audio' },
      }),
    ],
    clipKeyframes: new Map(),
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    isExporting: false,
  });
}

function getMutationResultData(result: ToolResult): MutationResultData {
  expect(result.success, result.error).toBe(true);
  return result.data as MutationResultData;
}

function expectIncreasingRevision(data: MutationResultData): void {
  expect(data.stateRevisionBefore).toEqual(expect.any(Number));
  expect(data.stateRevisionAfter).toEqual(expect.any(Number));
  expect(data.stateRevisionAfter).toBeGreaterThan(data.stateRevisionBefore);
}

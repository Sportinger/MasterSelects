import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleCreateComposition,
  handleDeleteMediaItem,
  handleRenameMediaItem,
} from '../../src/services/aiTools/handlers/media';
import { handleSetTrackMuted } from '../../src/services/aiTools/handlers/tracks';
import type { ToolResult } from '../../src/services/aiTools/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockTrack } from '../helpers/mockData';

type MediaStoreArg = Parameters<typeof handleCreateComposition>[1];

interface MutationEnvelope {
  stateRevisionBefore: number | null;
  stateRevisionAfter: number | null;
  entities: {
    created: Array<{ kind: string; id: string }>;
    updated: Array<{ kind: string; id: string }>;
    deleted: Array<{ kind: string; id: string }>;
  };
  warnings?: string[];
}

const initialTimelineState = useTimelineStore.getState();

describe('AI tool mutation envelopes B', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'audio-track', type: 'audio', muted: false })],
      clips: [],
    });
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.restoreAllMocks();
  });

  it('reports setTrackMuted as an updated track with an increasing timeline revision', async () => {
    const result = await handleSetTrackMuted(
      { trackId: 'audio-track', muted: true },
      useTimelineStore.getState(),
    );
    const envelope = mutationEnvelope(result);

    expect(envelope.entities).toEqual({
      created: [],
      updated: [{ kind: 'track', id: 'audio-track' }],
      deleted: [],
    });
    expect(envelope.stateRevisionBefore).not.toBeNull();
    expect(envelope.stateRevisionAfter).toBeGreaterThan(envelope.stateRevisionBefore!);
  });

  it('reports createComposition with a created composition ref and null media-store revisions', async () => {
    const composition = {
      id: 'composition-1',
      name: 'Sequence',
      type: 'composition',
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 60,
    };
    const mediaStore = {
      files: [],
      compositions: [],
      folders: [],
      createComposition: vi.fn(() => composition),
    } as unknown as MediaStoreArg;

    const envelope = mutationEnvelope(await handleCreateComposition(
      { name: 'Sequence', openAfterCreate: false },
      mediaStore,
    ));

    expect(envelope.stateRevisionBefore).toBeNull();
    expect(envelope.stateRevisionAfter).toBeNull();
    expect(envelope.entities.created).toEqual([{ kind: 'composition', id: 'composition-1' }]);
    expect(envelope.entities.updated).toEqual([]);
    expect(envelope.entities.deleted).toEqual([]);
  });

  it('reports renameMediaItem with an updated media-item ref', async () => {
    const mediaStore = {
      files: [{ id: 'media-1', name: 'Before.mp4' }],
      compositions: [],
      folders: [],
      renameFile: vi.fn(),
    } as unknown as MediaStoreArg;

    const envelope = mutationEnvelope(await handleRenameMediaItem(
      { itemId: 'media-1', newName: 'After.mp4' },
      mediaStore,
    ));

    expect(envelope.stateRevisionBefore).toBeNull();
    expect(envelope.stateRevisionAfter).toBeNull();
    expect(envelope.entities.updated).toEqual([{ kind: 'mediaItem', id: 'media-1' }]);
    expect(envelope.entities.created).toEqual([]);
    expect(envelope.entities.deleted).toEqual([]);
  });

  it('reports deleteMediaItem with a deleted media-item ref', async () => {
    const mediaStore = {
      files: [{ id: 'media-1', name: 'Delete.mp4' }],
      compositions: [],
      folders: [],
      deleteMediaFilesEverywhere: vi.fn(async () => ({
        deletedMediaFileIds: ['media-1'],
        removedClipCount: 0,
        usages: [],
        artifactFailures: [],
      })),
    } as unknown as MediaStoreArg;

    const envelope = mutationEnvelope(await handleDeleteMediaItem(
      { itemId: 'media-1' },
      mediaStore,
    ));

    expect(envelope.stateRevisionBefore).toBeNull();
    expect(envelope.stateRevisionAfter).toBeNull();
    expect(envelope.entities.deleted).toEqual([{ kind: 'mediaItem', id: 'media-1' }]);
    expect(envelope.entities.created).toEqual([]);
    expect(envelope.entities.updated).toEqual([]);
  });
});

function mutationEnvelope(result: ToolResult): MutationEnvelope {
  expect(result.success).toBe(true);
  const envelope = result.data as MutationEnvelope;
  expect(envelope).toHaveProperty('stateRevisionBefore');
  expect(envelope).toHaveProperty('stateRevisionAfter');
  expect(envelope).toEqual(expect.objectContaining({
    entities: expect.objectContaining({
      created: expect.any(Array),
      updated: expect.any(Array),
      deleted: expect.any(Array),
    }),
  }));
  return envelope;
}

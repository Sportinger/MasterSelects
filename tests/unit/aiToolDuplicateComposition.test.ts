import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand';
import type { Composition, MediaState } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types';
import { createCompositionSlice, type CompositionActions } from '../../src/stores/mediaStore/slices/compositionSlice';
import { withProjectStoreSyncGuard } from '../../src/services/project/projectStoreSyncGuard';
import { useTimelineStore } from '../../src/stores/timeline';
import { AI_TOOLS } from '../../src/services/aiTools/definitions';
import { getToolPolicy, checkToolAccess } from '../../src/services/aiTools/policy';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import {
  isKernelEditorToolName,
  KERNEL_PIN_PENDING_EDITOR_TOOL_NAMES,
} from '../../src/services/aiTools/editorToolCatalog';
import { createMockClip, createMockTrack } from '../helpers/mockData';

type TestStore = MediaState & CompositionActions;
type DuplicateData = {
  compositionId: string;
  warnings?: string[];
  entities: { created: Array<{ kind: string; id: string }> };
};

const hoisted = vi.hoisted(() => ({
  store: null as null | { getState: () => unknown },
  waitForCompositionReady: vi.fn(async () => true),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(vi.fn(), {
    getState: () => hoisted.store!.getState(),
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }),
}));

vi.mock('../../src/services/aiTools/handlers/media/runtime', () => ({
  waitForCompositionReady: hoisted.waitForCompositionReady,
}));

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: {
    invalidateComposition: vi.fn(),
    invalidateCompositionAndParents: vi.fn(),
    prepareComposition: vi.fn(async () => true),
  },
}));

const { handleDuplicateComposition } = await import('../../src/services/aiTools/handlers/media/compositionDuplicate');

const initialTimelineState = useTimelineStore.getState();

function composition(id: string, overrides: Partial<Composition> = {}): Composition {
  return {
    id,
    name: `Comp ${id}`,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 60,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [],
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
    ...overrides,
  };
}

function useTestStore(compositions: Composition[], activeCompositionId: string | null) {
  const store = createStore<TestStore>()((set, get) => ({
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
  hoisted.store = store;
  return store;
}

async function duplicate(args: Record<string, unknown>) {
  return handleDuplicateComposition(args, hoisted.store!.getState() as never);
}

describe('duplicateComposition AI tool', () => {
  beforeEach(() => {
    hoisted.waitForCompositionReady.mockClear();
    useTimelineStore.setState(initialTimelineState);
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'video-2', type: 'video', visible: false }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', source: { type: 'solid', naturalDuration: 5 } as TimelineClip['source'] }),
        createMockClip({ id: 'b', trackId: 'video-2', parentClipId: 'a', source: { type: 'solid', naturalDuration: 5 } as TimelineClip['source'] }),
      ],
    });
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    hoisted.store = null;
  });

  it('copies the live active timeline and reports the copy next to the source counts', async () => {
    const store = useTestStore([composition('main')], 'main');

    const result = await duplicate({ compositionId: 'main' });

    expect(result.success).toBe(true);
    const data = result.data as DuplicateData;
    expect(data).toMatchObject({
      name: 'Comp main Copy',
      clipCount: 2,
      trackCount: 3,
      videoTrackCount: 2,
      audioTrackCount: 1,
      opened: false,
      privateCompositionCopies: 0,
      source: {
        compositionId: 'main',
        wasActive: true,
        copiedFrom: 'live-timeline',
        clipCount: 2,
        trackCount: 3,
      },
    });
    expect(data.warnings).toBeUndefined();
    expect(data.entities.created).toEqual([{ kind: 'composition', id: data.compositionId }]);
    const copy = store.getState().compositions.find((entry) => entry.id === data.compositionId)!;
    expect(copy.timelineData!.clips.find((clip) => clip.id === 'b')!.parentClipId).toBe('a');
    expect(store.getState().activeCompositionId).toBe('main');
  });

  it('applies a name and opens the copy on request', async () => {
    const store = useTestStore([composition('main'), composition('other')], 'main');
    const openCompositionTab = vi.fn(async () => undefined);
    store.setState({ openCompositionTab });

    const result = await duplicate({ compositionId: 'other', name: 'Other v2', open: true });

    const data = result.data as DuplicateData;
    expect(result.success).toBe(true);
    expect(data).toMatchObject({
      name: 'Other v2',
      opened: true,
      clipCount: 0,
      trackCount: 1,
      source: { wasActive: false, copiedFrom: 'stored-timeline' },
    });
    expect(openCompositionTab).toHaveBeenCalledWith(data.compositionId);
    expect(hoisted.waitForCompositionReady).toHaveBeenCalledWith(data.compositionId);
  });

  it('waits for a running restore before copying the live timeline', async () => {
    useTestStore([composition('main')], 'main');
    let release!: () => void;
    const restore = withProjectStoreSyncGuard(() => new Promise<void>((resolve) => { release = resolve; }));

    const pending = duplicate({ compositionId: 'main' });
    await Promise.resolve();
    release();
    await restore;
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ clipCount: 2, source: { copiedFrom: 'live-timeline' } });
  });

  it('fails with a reason instead of returning nothing', async () => {
    useTestStore([
      composition('main'),
      composition('transition', {
        transitionComp: { kind: 'transition-comp', parentCompositionId: 'main' } as Composition['transitionComp'],
      }),
      composition('caption', {
        captionComp: { kind: 'caption-comp', parentCompositionId: 'main' } as Composition['captionComp'],
      }),
    ], 'main');

    await expect(duplicate({})).resolves.toEqual({ success: false, error: 'compositionId is required.' });
    await expect(duplicate({ compositionId: 'main', name: 4 })).resolves.toEqual({ success: false, error: 'name must be a string.' });
    await expect(duplicate({ compositionId: 'main', name: '  ' })).resolves.toEqual({ success: false, error: 'name must not be empty.' });
    await expect(duplicate({ compositionId: 'main', open: 'yes' })).resolves.toEqual({ success: false, error: 'open must be a boolean.' });
    await expect(duplicate({ compositionId: 'nope' })).resolves.toEqual({ success: false, error: 'Composition not found: nope' });
    const transition = await duplicate({ compositionId: 'transition' });
    expect(transition.success).toBe(false);
    expect(transition.error).toContain('private composition of a transition in composition main; duplicate that composition instead');
    const caption = await duplicate({ compositionId: 'caption' });
    expect(caption.success).toBe(false);
    expect(caption.error).toContain('private caption composition of composition main');
    expect((hoisted.store!.getState() as TestStore).compositions).toHaveLength(3);
  });

  it('is a registered, undoable, bridge-reachable tool kept out of the pinned kernel catalog', () => {
    const definition = AI_TOOLS.find((tool) => tool.function.name === 'duplicateComposition');
    expect(definition?.function.parameters).toMatchObject({
      required: ['compositionId'],
      additionalProperties: false,
    });
    expect(getToolPolicy('duplicateComposition')).toMatchObject({ readOnly: false, riskLevel: 'low' });
    expect(checkToolAccess('duplicateComposition', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('duplicateComposition', 'chat').allowed).toBe(true);
    expect(MODIFYING_TOOLS.has('duplicateComposition')).toBe(true);
    // Joining the Fast V2 catalog changes its pinned digest; that needs the kernel pin in lockstep.
    expect(KERNEL_PIN_PENDING_EDITOR_TOOL_NAMES.has('duplicateComposition')).toBe(true);
    expect(isKernelEditorToolName('duplicateComposition')).toBe(false);
  });
});

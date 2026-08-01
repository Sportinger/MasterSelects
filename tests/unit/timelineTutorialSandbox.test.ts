import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(),
}));

import { createTimelineTutorialSandbox } from '../../src/components/common/tutorial/timelineTutorialSandbox';
import { useDockStore } from '../../src/stores/dockStore';
import {
  captureSnapshot,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialDockState = useDockStore.getState();
const initialMediaState = useMediaStore.getState();
const initialTimelineState = useTimelineStore.getState();

describe('timeline tutorial sandbox', () => {
  beforeEach(() => {
    useDockStore.setState(initialDockState);
    useMediaStore.setState(initialMediaState);
    useTimelineStore.setState(initialTimelineState);
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    useHistoryStore.getState().clearHistory();
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    initHistoryStoreRefs({
      dock: {
        getState: useDockStore.getState,
        setState: useDockStore.setState,
      },
      media: {
        getState: useMediaStore.getState,
        setState: useMediaStore.setState,
      },
      timeline: {
        getState: useTimelineStore.getState,
        setState: useTimelineStore.setState,
      },
    });
    captureSnapshot('before timeline tutorial');
  });

  afterEach(() => {
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    useHistoryStore.getState().clearHistory();
    useDockStore.setState(initialDockState);
    useMediaStore.setState(initialMediaState);
    useTimelineStore.setState(initialTimelineState);
  });

  it('uses isolated media and track state, then leaves no project or undo changes', () => {
    const initialTrackIds = useTimelineStore.getState().tracks.map((track) => track.id);
    const initialClipIds = useTimelineStore.getState().clips.map((clip) => clip.id);
    const initialSolidIds = useMediaStore.getState().solidItems.map((item) => item.id);
    const activeHistoryNodeId = useHistoryStore.getState().activeNodeId;

    const sandbox = createTimelineTutorialSandbox();

    expect(useHistoryStore.getState().batchId).not.toBeNull();
    expect(useTimelineStore.getState().tracks.map((track) => track.id)).toContain(
      sandbox.getTrackId(),
    );
    expect(useMediaStore.getState().solidItems.map((item) => item.id)).toContain(
      sandbox.getMediaId(),
    );

    const clipId = sandbox.ensureClip();
    expect(clipId).not.toBeNull();
    sandbox.moveClipTo(3);
    sandbox.trimClipToDuration(2.5);
    expect(sandbox.getClipBounds()).toEqual({
      duration: 2.5,
      startTime: 3,
      trackId: sandbox.getTrackId(),
    });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toEqual(
      expect.objectContaining({ duration: 2.5, startTime: 3 }),
    );

    sandbox.cleanup();

    expect(sandbox.getClipBounds()).toBeNull();
    expect(useTimelineStore.getState().tracks.map((track) => track.id)).toEqual(initialTrackIds);
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(initialClipIds);
    expect(useMediaStore.getState().solidItems.map((item) => item.id)).toEqual(initialSolidIds);
    expect(useHistoryStore.getState().batchId).toBeNull();
    expect(useHistoryStore.getState().activeNodeId).toBe(activeHistoryNodeId);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });
});

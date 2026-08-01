import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(),
}));

import { createWp1AgentTransactionAdapter } from '../../src/services/kernelClient/wp1Spike/agentTransactionAdapter';
import {
  captureSnapshot,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useMediaStore, type TextItem } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { isExclusiveTimelineMutationLeaseActive } from '../../src/stores/timeline/exclusiveMutationLease';
import type { TimelineStore } from '../../src/stores/timeline/types';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function initializeRealMediaHistoryRefs(): void {
  initHistoryStoreRefs({
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
    media: {
      getState: useMediaStore.getState,
      setState: useMediaStore.setState,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
}

function mediaTextNames(): string[] {
  return useMediaStore.getState().textItems.map((item) => item.name);
}

function createTextItem(id: string, name: string): TextItem {
  return {
    id,
    name,
    type: 'text',
    parentId: null,
    createdAt: 1,
    text: name,
    fontFamily: 'Arial',
    fontSize: 48,
    color: '#ffffff',
    duration: 5,
  };
}

function setOwnerTextItem(id: string, name: string): void {
  useMediaStore.setState((state) => ({
    textItems: [...state.textItems, createTextItem(id, name)],
  }));
}

function expectForeignMediaWritersBlocked(): void {
  expect(() => useMediaStore.getState().createTextItem('foreign action'))
    .toThrow('temporarily locked');

  let updaterEvaluated = false;
  expect(() => useMediaStore.setState((state) => {
    updaterEvaluated = true;
    return { textItems: state.textItems };
  })).toThrow('temporarily locked');
  expect(updaterEvaluated).toBe(false);
}

function settleLeakedHandle(
  transaction: ReturnType<typeof createWp1AgentTransactionAdapter>,
  handle: unknown,
): void {
  if (!isExclusiveTimelineMutationLeaseActive()) return;
  try {
    transaction.abort(handle);
  } catch {
    // A deliberately lost history owner still releases the lease while
    // reporting ownership loss.
  }
}

describe('exclusive history snapshot mutation lease', () => {
  beforeEach(() => {
    expect(isExclusiveTimelineMutationLeaseActive()).toBe(false);
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    initializeRealMediaHistoryRefs();
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState({
      ...initialMediaState,
      textItems: [],
    });
    captureSnapshot('exclusive snapshot lease base');
  });

  afterEach(() => {
    expect(isExclusiveTimelineMutationLeaseActive()).toBe(false);
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
  });

  it('commits an authorized real Media-store edit while rejecting foreign internal and external writers', () => {
    const transaction = createWp1AgentTransactionAdapter();
    const handle = transaction.begin('verified media commit');
    try {
      transaction.run(handle, () => {
        setOwnerTextItem('verified-owner', 'verified owner');
      });
      expect(mediaTextNames()).toEqual(['verified owner']);
      expectForeignMediaWritersBlocked();

      transaction.commit(handle);

      expect(isExclusiveTimelineMutationLeaseActive()).toBe(false);
      expect(mediaTextNames()).toEqual(['verified owner']);
      expect(useHistoryStore.getState().canUndo()).toBe(true);
      expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
      expect(mediaTextNames()).toEqual([]);
    } finally {
      settleLeakedHandle(transaction, handle);
    }
  });

  it('aborts an authorized real Media-store edit without rolling back a foreign edit because it was never admitted', () => {
    const transaction = createWp1AgentTransactionAdapter();
    const handle = transaction.begin('verified media abort');
    try {
      transaction.run(handle, () => {
        setOwnerTextItem('verified-owner', 'verified owner');
      });
      expectForeignMediaWritersBlocked();

      transaction.abort(handle);

      expect(isExclusiveTimelineMutationLeaseActive()).toBe(false);
      expect(mediaTextNames()).toEqual([]);
      expect(useHistoryStore.getState().canUndo()).toBe(false);
    } finally {
      settleLeakedHandle(transaction, handle);
    }
  });

  it('holds the real Media-store barrier through history ownership loss and releases it on settlement', () => {
    const transaction = createWp1AgentTransactionAdapter();
    const handle = transaction.begin('verified ownership loss');
    try {
      transaction.run(handle, () => {
        setOwnerTextItem('verified-before-loss', 'verified before ownership loss');
      });
      useHistoryStore.setState({ batchId: null, batchLabel: null });
      expectForeignMediaWritersBlocked();

      expect(() => transaction.commit(handle))
        .toThrow('lost history transaction ownership');

      expect(isExclusiveTimelineMutationLeaseActive()).toBe(false);
      expect(() => setOwnerTextItem('post-settlement', 'post-settlement'))
        .not.toThrow();
      expect(mediaTextNames()).toEqual([
        'verified before ownership loss',
        'post-settlement',
      ]);
    } finally {
      settleLeakedHandle(transaction, handle);
    }
  });

  it('blocks direct object patches for every non-durable Timeline field captured by History', () => {
    const transaction = createWp1AgentTransactionAdapter();
    const handle = transaction.begin('verified timeline snapshot fields');
    try {
      const before = useTimelineStore.getState();
      const patches: Array<Partial<TimelineStore>> = [
        { selectedClipIds: new Set(['foreign-selection']) },
        { selectedKeyframeIds: new Set(['foreign-keyframe']) },
        { zoom: before.zoom + 0.25 },
        { scrollX: before.scrollX + 1 },
        { layers: [...before.layers] },
        { selectedLayerId: 'foreign-layer' },
      ];

      for (const patch of patches) {
        expect(() => useTimelineStore.setState(patch)).toThrow('temporarily locked');
      }

      const after = useTimelineStore.getState();
      expect(after.selectedClipIds).toBe(before.selectedClipIds);
      expect(after.selectedKeyframeIds).toBe(before.selectedKeyframeIds);
      expect(after.zoom).toBe(before.zoom);
      expect(after.scrollX).toBe(before.scrollX);
      expect(after.layers).toBe(before.layers);
      expect(after.selectedLayerId).toBe(before.selectedLayerId);

      transaction.abort(handle);
    } finally {
      settleLeakedHandle(transaction, handle);
    }
  });
});

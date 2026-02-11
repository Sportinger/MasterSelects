import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from 'zustand';
import type { MediaState, Composition } from '../../../src/stores/mediaStore/types';
import { createCompositionSlice, type CompositionActions } from '../../../src/stores/mediaStore/slices/compositionSlice';

// The compositionSlice calls useTimelineStore and useSettingsStore internally,
// but these are mocked in tests/setup.ts. We rely on those mocks here.

type TestMediaStore = MediaState & CompositionActions;

function createTestMediaStore(overrides?: Partial<MediaState>) {
  const defaultComp: Composition = {
    id: 'comp-1',
    name: 'Comp 1',
    type: 'composition',
    parentId: null,
    createdAt: 1000,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 60,
    backgroundColor: '#000000',
  };

  return createStore<TestMediaStore>()((set, get) => {
    const compositionActions = createCompositionSlice(set as any, get as any);

    return {
      // Minimal initial state
      files: [],
      compositions: [defaultComp],
      folders: [],
      textItems: [],
      solidItems: [],
      activeCompositionId: 'comp-1',
      openCompositionIds: ['comp-1'],
      slotAssignments: {},
      previewCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      selectedIds: [],
      expandedFolderIds: [],
      currentProjectId: null,
      currentProjectName: 'Untitled Project',
      isLoading: false,
      proxyEnabled: false,
      proxyGenerationQueue: [],
      currentlyGeneratingProxyId: null,
      fileSystemSupported: false,
      proxyFolderName: null,
      ...compositionActions,
      ...overrides,
    } as TestMediaStore;
  });
}

describe('compositionSlice', () => {
  let store: ReturnType<typeof createTestMediaStore>;

  beforeEach(() => {
    store = createTestMediaStore();
  });

  // ─── createComposition ────────────────────────────────────────────

  it('createComposition: creates a new composition with defaults', () => {
    const comp = store.getState().createComposition('My Comp');
    expect(comp.name).toBe('My Comp');
    expect(comp.type).toBe('composition');
    expect(comp.width).toBe(1920); // from mocked settingsStore
    expect(comp.height).toBe(1080);
    expect(comp.frameRate).toBe(30);
    expect(comp.duration).toBe(60);
    expect(comp.backgroundColor).toBe('#000000');
    expect(comp.id).toBeDefined();
    // Verify it was added to the store
    const comps = store.getState().compositions;
    expect(comps.find(c => c.id === comp.id)).toBeDefined();
  });

  it('createComposition: uses provided settings overrides', () => {
    const comp = store.getState().createComposition('Custom', {
      width: 3840,
      height: 2160,
      frameRate: 60,
      duration: 120,
      backgroundColor: '#ff0000',
    });
    expect(comp.width).toBe(3840);
    expect(comp.height).toBe(2160);
    expect(comp.frameRate).toBe(60);
    expect(comp.duration).toBe(120);
    expect(comp.backgroundColor).toBe('#ff0000');
  });

  it('createComposition: assigns unique IDs to each composition', () => {
    const comp1 = store.getState().createComposition('A');
    const comp2 = store.getState().createComposition('B');
    expect(comp1.id).not.toBe(comp2.id);
    expect(store.getState().compositions.length).toBe(3); // default + 2 new
  });

  // ─── duplicateComposition ─────────────────────────────────────────

  it('duplicateComposition: creates a copy with new id and name suffix', () => {
    const duplicate = store.getState().duplicateComposition('comp-1');
    expect(duplicate).not.toBeNull();
    expect(duplicate!.name).toBe('Comp 1 Copy');
    expect(duplicate!.id).not.toBe('comp-1');
    expect(duplicate!.width).toBe(1920);
    expect(duplicate!.height).toBe(1080);
    expect(store.getState().compositions.length).toBe(2);
  });

  it('duplicateComposition: returns null for nonexistent id', () => {
    const result = store.getState().duplicateComposition('nonexistent');
    expect(result).toBeNull();
  });

  // ─── removeComposition ────────────────────────────────────────────

  it('removeComposition: removes composition from list', () => {
    const comp = store.getState().createComposition('To Remove');
    expect(store.getState().compositions.length).toBe(2);
    store.getState().removeComposition(comp.id);
    expect(store.getState().compositions.length).toBe(1);
    expect(store.getState().compositions.find(c => c.id === comp.id)).toBeUndefined();
  });

  it('removeComposition: clears activeCompositionId when active comp is removed', () => {
    const comp = store.getState().createComposition('Active');
    store.setState({ activeCompositionId: comp.id });
    store.getState().removeComposition(comp.id);
    expect(store.getState().activeCompositionId).toBeNull();
  });

  it('removeComposition: removes from openCompositionIds', () => {
    const comp = store.getState().createComposition('Open');
    store.setState({ openCompositionIds: ['comp-1', comp.id] });
    store.getState().removeComposition(comp.id);
    expect(store.getState().openCompositionIds).not.toContain(comp.id);
  });

  it('removeComposition: removes from selectedIds', () => {
    const comp = store.getState().createComposition('Selected');
    store.setState({ selectedIds: [comp.id, 'other-item'] });
    store.getState().removeComposition(comp.id);
    expect(store.getState().selectedIds).toEqual(['other-item']);
  });

  it('removeComposition: cleans up slotAssignments', () => {
    const comp = store.getState().createComposition('Slotted');
    store.setState({ slotAssignments: { [comp.id]: 3 } });
    store.getState().removeComposition(comp.id);
    expect(store.getState().slotAssignments[comp.id]).toBeUndefined();
  });

  // ─── updateComposition ────────────────────────────────────────────

  it('updateComposition: updates name and background color', () => {
    store.getState().updateComposition('comp-1', {
      name: 'Renamed',
      backgroundColor: '#00ff00',
    });
    const comp = store.getState().compositions.find(c => c.id === 'comp-1')!;
    expect(comp.name).toBe('Renamed');
    expect(comp.backgroundColor).toBe('#00ff00');
  });

  it('updateComposition: updates fps and duration', () => {
    store.getState().updateComposition('comp-1', {
      frameRate: 24,
      duration: 120,
    });
    const comp = store.getState().compositions.find(c => c.id === 'comp-1')!;
    expect(comp.frameRate).toBe(24);
    expect(comp.duration).toBe(120);
  });

  it('updateComposition: updates resolution (width/height)', () => {
    // For a non-active composition to avoid the clip transform adjustment path
    const comp = store.getState().createComposition('ResTest');
    store.setState({ activeCompositionId: 'comp-1' }); // Ensure comp is NOT active
    store.getState().updateComposition(comp.id, { width: 3840, height: 2160 });
    const updated = store.getState().compositions.find(c => c.id === comp.id)!;
    expect(updated.width).toBe(3840);
    expect(updated.height).toBe(2160);
  });

  // ─── getActiveComposition ─────────────────────────────────────────

  it('getActiveComposition: returns the currently active composition', () => {
    const active = store.getState().getActiveComposition();
    expect(active).toBeDefined();
    expect(active!.id).toBe('comp-1');
    expect(active!.name).toBe('Comp 1');
  });

  it('getActiveComposition: returns undefined when no active composition', () => {
    store.setState({ activeCompositionId: null });
    expect(store.getState().getActiveComposition()).toBeUndefined();
  });

  // ─── getOpenCompositions ──────────────────────────────────────────

  it('getOpenCompositions: returns compositions matching openCompositionIds', () => {
    const comp2 = store.getState().createComposition('Second');
    store.setState({ openCompositionIds: ['comp-1', comp2.id] });
    const open = store.getState().getOpenCompositions();
    expect(open.length).toBe(2);
    expect(open[0].id).toBe('comp-1');
    expect(open[1].id).toBe(comp2.id);
  });

  it('getOpenCompositions: filters out deleted compositions', () => {
    store.setState({ openCompositionIds: ['comp-1', 'deleted-id'] });
    const open = store.getState().getOpenCompositions();
    expect(open.length).toBe(1);
    expect(open[0].id).toBe('comp-1');
  });

  // ─── reorderCompositionTabs ───────────────────────────────────────

  it('reorderCompositionTabs: swaps tab order', () => {
    const comp2 = store.getState().createComposition('B');
    const comp3 = store.getState().createComposition('C');
    store.setState({ openCompositionIds: ['comp-1', comp2.id, comp3.id] });
    store.getState().reorderCompositionTabs(0, 2);
    expect(store.getState().openCompositionIds).toEqual([comp2.id, comp3.id, 'comp-1']);
  });

  it('reorderCompositionTabs: no-op for same index', () => {
    store.setState({ openCompositionIds: ['comp-1', 'comp-2'] });
    store.getState().reorderCompositionTabs(0, 0);
    expect(store.getState().openCompositionIds).toEqual(['comp-1', 'comp-2']);
  });

  it('reorderCompositionTabs: no-op for out-of-bounds indices', () => {
    store.setState({ openCompositionIds: ['comp-1'] });
    store.getState().reorderCompositionTabs(-1, 5);
    expect(store.getState().openCompositionIds).toEqual(['comp-1']);
  });

  // ─── Slot management ──────────────────────────────────────────────

  it('moveSlot: assigns composition to a slot', () => {
    store.getState().moveSlot('comp-1', 5);
    expect(store.getState().slotAssignments['comp-1']).toBe(5);
  });

  it('moveSlot: swaps compositions when target slot is occupied', () => {
    const comp2 = store.getState().createComposition('B');
    store.setState({ slotAssignments: { 'comp-1': 0, [comp2.id]: 3 } });
    store.getState().moveSlot('comp-1', 3);
    expect(store.getState().slotAssignments['comp-1']).toBe(3);
    expect(store.getState().slotAssignments[comp2.id]).toBe(0);
  });

  it('unassignSlot: removes slot assignment', () => {
    store.setState({ slotAssignments: { 'comp-1': 2 } });
    store.getState().unassignSlot('comp-1');
    expect(store.getState().slotAssignments['comp-1']).toBeUndefined();
  });

  it('getSlotMap: returns correctly sized array with assigned compositions', () => {
    store.setState({ slotAssignments: { 'comp-1': 2 } });
    const map = store.getState().getSlotMap(6);
    expect(map.length).toBe(6);
    expect(map[2]?.id).toBe('comp-1');
    expect(map[0]).toBeNull();
    expect(map[1]).toBeNull();
    expect(map[3]).toBeNull();
  });

  // ─── Multi-layer playback ─────────────────────────────────────────

  it('activateOnLayer: assigns composition to a layer', () => {
    store.getState().activateOnLayer('comp-1', 0);
    expect(store.getState().activeLayerSlots[0]).toBe('comp-1');
  });

  it('activateOnLayer: moves composition from previous layer', () => {
    store.getState().activateOnLayer('comp-1', 0);
    store.getState().activateOnLayer('comp-1', 2);
    expect(store.getState().activeLayerSlots[0]).toBeUndefined();
    expect(store.getState().activeLayerSlots[2]).toBe('comp-1');
  });

  it('deactivateLayer: removes composition from a layer', () => {
    store.getState().activateOnLayer('comp-1', 1);
    store.getState().deactivateLayer(1);
    expect(store.getState().activeLayerSlots[1]).toBeUndefined();
  });

  it('deactivateAllLayers: clears all layer assignments', () => {
    const comp2 = store.getState().createComposition('B');
    store.getState().activateOnLayer('comp-1', 0);
    store.getState().activateOnLayer(comp2.id, 1);
    store.getState().deactivateAllLayers();
    expect(Object.keys(store.getState().activeLayerSlots).length).toBe(0);
  });

  // ─── setPreviewComposition ────────────────────────────────────────

  it('setPreviewComposition: sets and clears preview ID', () => {
    store.getState().setPreviewComposition('comp-1');
    expect(store.getState().previewCompositionId).toBe('comp-1');
    store.getState().setPreviewComposition(null);
    expect(store.getState().previewCompositionId).toBeNull();
  });
});

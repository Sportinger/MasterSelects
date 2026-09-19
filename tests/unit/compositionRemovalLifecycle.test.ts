import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearTimeline: vi.fn(),
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({ clearTimeline: mocks.clearTimeline }),
  },
}));

const { createCompositionCrudActions } = await import(
  '../../src/stores/mediaStore/slices/composition/crudActions'
);

function composition(id: string) {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1080,
    height: 1920,
    frameRate: 30,
    duration: 10,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [],
      clips: [],
      duration: 10,
      playheadPosition: 0,
    },
  };
}

describe('composition removal lifecycle', () => {
  beforeEach(() => {
    mocks.clearTimeline.mockReset();
  });

  it('clears the live timeline when the active composition is removed', () => {
    let state = {
      compositions: [composition('active-comp')],
      activeCompositionId: 'active-comp',
      openCompositionIds: ['active-comp'],
      selectedIds: ['active-comp'],
      slotAssignments: {},
      slotClipSettings: {},
      selectedSlotCompositionId: null,
    };
    const set = vi.fn((update) => {
      const partial = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...partial };
    });
    const get = () => state;
    const actions = createCompositionCrudActions(set as never, get as never);

    actions.removeComposition('active-comp');

    expect(state.compositions).toEqual([]);
    expect(state.activeCompositionId).toBeNull();
    expect(state.openCompositionIds).toEqual([]);
    expect(mocks.clearTimeline).toHaveBeenCalledTimes(1);
  });

  it('does not clear the live timeline when an inactive composition is removed', () => {
    let state = {
      compositions: [composition('active-comp'), composition('other-comp')],
      activeCompositionId: 'active-comp',
      openCompositionIds: ['active-comp', 'other-comp'],
      selectedIds: [],
      slotAssignments: {},
      slotClipSettings: {},
      selectedSlotCompositionId: null,
    };
    const set = vi.fn((update) => {
      const partial = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...partial };
    });
    const get = () => state;
    const actions = createCompositionCrudActions(set as never, get as never);

    actions.removeComposition('other-comp');

    expect(state.compositions.map((item) => item.id)).toEqual(['active-comp']);
    expect(state.activeCompositionId).toBe('active-comp');
    expect(mocks.clearTimeline).not.toHaveBeenCalled();
  });
});

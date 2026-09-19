import { create } from 'zustand';

export type TimelinePanelMode = 'timeline' | 'slot-grid';

interface TimelinePanelModeState {
  modes: Record<string, TimelinePanelMode>;
  registerHost: (panelId: string, initialMode: TimelinePanelMode) => void;
  unregisterHost: (panelId: string) => void;
  showSlotGrid: (panelId: string) => void;
  showTimeline: (panelId: string) => void;
}

/** Runtime view modes for the shared Timeline / Slot Grid dock-panel host. */
export const useSlotGridPanelStore = create<TimelinePanelModeState>((set) => ({
  modes: {},
  registerHost: (panelId, initialMode) => set(state => {
    if (state.modes[panelId]) return state;
    const anotherTimelineIsMounted = initialMode === 'timeline'
      && Object.values(state.modes).includes('timeline');
    return {
      modes: {
        ...state.modes,
        [panelId]: anotherTimelineIsMounted ? 'slot-grid' : initialMode,
      },
    };
  }),
  unregisterHost: panelId => set(state => {
    const { [panelId]: _removed, ...modes } = state.modes;
    return { modes };
  }),
  showSlotGrid: panelId => set(state => ({
    modes: { ...state.modes, [panelId]: 'slot-grid' },
  })),
  showTimeline: panelId => set(state => ({
    modes: Object.fromEntries(
      Object.entries(state.modes).map(([id, mode]) => [
        id,
        id === panelId ? 'timeline' : mode === 'timeline' ? 'slot-grid' : mode,
      ]),
    ),
  })),
}));

export function isSlotGridPanelActive(): boolean {
  return Object.values(useSlotGridPanelStore.getState().modes).includes('slot-grid');
}

export const selectIsSlotGridPanelActive = (state: TimelinePanelModeState): boolean => (
  Object.values(state.modes).includes('slot-grid')
);

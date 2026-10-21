import { create } from 'zustand';
import { Logger } from '../services/logger';

const log = Logger.create('SlotGridPanelStore');

export type TimelinePanelMode = 'timeline' | 'slot-grid';

interface TimelinePanelModeState {
  modes: Record<string, TimelinePanelMode>;
  /** Mounted host count per panel id; a panel id can be rendered by more than one host. */
  hostCounts: Record<string, number>;
  registerHost: (panelId: string, initialMode: TimelinePanelMode) => void;
  unregisterHost: (panelId: string) => void;
  showSlotGrid: (panelId: string) => void;
  showTimeline: (panelId: string) => void;
}

/** Runtime view modes for the shared Timeline / Slot Grid dock-panel host. */
export const useSlotGridPanelStore = create<TimelinePanelModeState>((set) => ({
  modes: {},
  hostCounts: {},
  registerHost: (panelId, initialMode) => set(state => {
    const hostCount = state.hostCounts[panelId] ?? 0;
    const hostCounts = { ...state.hostCounts, [panelId]: hostCount + 1 };
    if (hostCount > 0) {
      // A second host for the same panel id (duplicated layout entry) shares the
      // existing mode instead of re-deciding it, which used to ping-pong forever.
      log.warn('Panel id is rendered by more than one Timeline/Slot Grid host; sharing its view mode', {
        panelId,
        hosts: hostCount + 1,
      });
    }
    if (state.modes[panelId]) return { hostCounts };
    const anotherTimelineIsMounted = initialMode === 'timeline'
      && Object.values(state.modes).includes('timeline');
    return {
      hostCounts,
      modes: {
        ...state.modes,
        [panelId]: anotherTimelineIsMounted ? 'slot-grid' : initialMode,
      },
    };
  }),
  unregisterHost: panelId => set(state => {
    const hostCount = state.hostCounts[panelId] ?? 0;
    if (hostCount > 1) {
      return { hostCounts: { ...state.hostCounts, [panelId]: hostCount - 1 } };
    }
    if (hostCount === 0 && !(panelId in state.modes)) return state;
    const { [panelId]: _removedCount, ...hostCounts } = state.hostCounts;
    const { [panelId]: _removedMode, ...modes } = state.modes;
    return { hostCounts, modes };
  }),
  showSlotGrid: panelId => set(state => (
    state.modes[panelId] === 'slot-grid'
      ? state
      : { modes: { ...state.modes, [panelId]: 'slot-grid' } }
  )),
  showTimeline: panelId => set(state => {
    if (state.modes[panelId] === 'timeline'
      && Object.entries(state.modes).every(([id, mode]) => id === panelId || mode !== 'timeline')) {
      return state;
    }
    return {
      modes: Object.fromEntries(
        Object.entries(state.modes).map(([id, mode]) => [
          id,
          id === panelId ? 'timeline' : mode === 'timeline' ? 'slot-grid' : mode,
        ]),
      ),
    };
  }),
}));

export function isSlotGridPanelActive(): boolean {
  return Object.values(useSlotGridPanelStore.getState().modes).includes('slot-grid');
}

export const selectIsSlotGridPanelActive = (state: TimelinePanelModeState): boolean => (
  Object.values(state.modes).includes('slot-grid')
);

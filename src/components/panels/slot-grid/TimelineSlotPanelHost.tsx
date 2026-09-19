import { useEffect } from 'react';
import { useDockStore } from '../../../stores/dockStore';
import {
  useSlotGridPanelStore,
  type TimelinePanelMode,
} from '../../../stores/slotGridPanelStore';
import { Timeline } from '../../timeline/Timeline';
import { SlotGridPanel } from './SlotGridPanel';

interface TimelineSlotPanelHostProps {
  initialMode: TimelinePanelMode;
  panelId: string;
}

/** One dock-panel host with locally switchable Timeline and Slot Grid views. */
export function TimelineSlotPanelHost({
  initialMode,
  panelId,
}: TimelineSlotPanelHostProps) {
  const mode = useSlotGridPanelStore(state => state.modes[panelId] ?? initialMode);
  const registerHost = useSlotGridPanelStore(state => state.registerHost);
  const unregisterHost = useSlotGridPanelStore(state => state.unregisterHost);
  const showSlotGrid = useSlotGridPanelStore(state => state.showSlotGrid);
  const showTimeline = useSlotGridPanelStore(state => state.showTimeline);
  const updatePanelData = useDockStore(state => state.updatePanelData);

  useEffect(() => {
    registerHost(panelId, initialMode);
    return () => unregisterHost(panelId);
  }, [initialMode, panelId, registerHost, unregisterHost]);

  useEffect(() => {
    updatePanelData(panelId, { timelineSurfaceMode: mode });
  }, [mode, panelId, updatePanelData]);

  return mode === 'timeline'
    ? <Timeline onShowSlotGrid={() => showSlotGrid(panelId)} />
    : <SlotGridPanel onShowTimeline={() => showTimeline(panelId)} />;
}

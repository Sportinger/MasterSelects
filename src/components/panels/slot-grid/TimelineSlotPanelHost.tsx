import { useCallback, useEffect, useRef } from 'react';
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

  // initialMode mirrors the panel data this host writes below. Re-registering on
  // every data write fed the mode back into itself and could loop (React #185),
  // so registration follows the panel id only and reads the latest initial mode.
  const initialModeRef = useRef(initialMode);
  useEffect(() => {
    initialModeRef.current = initialMode;
  }, [initialMode]);

  useEffect(() => {
    registerHost(panelId, initialModeRef.current);
    return () => unregisterHost(panelId);
  }, [panelId, registerHost, unregisterHost]);

  useEffect(() => {
    updatePanelData(panelId, { timelineSurfaceMode: mode });
  }, [mode, panelId, updatePanelData]);

  const handleShowSlotGrid = useCallback(() => showSlotGrid(panelId), [panelId, showSlotGrid]);
  const handleShowTimeline = useCallback(() => showTimeline(panelId), [panelId, showTimeline]);

  return mode === 'timeline'
    ? <Timeline onShowSlotGrid={handleShowSlotGrid} />
    : <SlotGridPanel onShowTimeline={handleShowTimeline} />;
}

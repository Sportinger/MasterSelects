import { SlotGrid } from '../../timeline/SlotGrid';
import './SlotGridPanel.css';

/**
 * Dockable host for the existing Slot Grid: the same launch surface the
 * timeline morphs into, always in slot mode, usable side by side with a
 * normal timeline (e.g. as the Scenes strip of the LIVE workspace).
 */
interface SlotGridPanelProps {
  onShowTimeline: () => void;
}

export function SlotGridPanel({ onShowTimeline }: SlotGridPanelProps) {
  return (
    <div className="slot-grid-panel">
      <div className="slot-grid-toolbar slot-grid-panel-toolbar">
        <button
          type="button"
          className="btn btn-sm btn-icon btn-active"
          onClick={onShowTimeline}
          title="Show Timeline"
          aria-label="Show Timeline"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            <rect x="1" y="2" width="14" height="2" rx="0.5" />
            <rect x="1" y="7" width="14" height="2" rx="0.5" />
            <rect x="1" y="12" width="14" height="2" rx="0.5" />
          </svg>
        </button>
        <span className="slot-grid-toolbar-title">Slot Grid</span>
      </div>
      <div className="slot-grid-panel-content">
        <SlotGrid opacity={1} standalone onShowTimeline={onShowTimeline} />
      </div>
    </div>
  );
}

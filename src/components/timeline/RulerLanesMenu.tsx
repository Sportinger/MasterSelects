// Ruler-lanes checklist menu (issue #257, Packet 5).
//
// A small dropdown in the ruler-header control strip that toggles which ruler
// formats are stacked. Each format is unique (the store enforces it), so this is
// an ordered checklist: checking adds a lane, unchecking removes it. Reuses the
// existing view-dropdown styling for consistency with the View menu.

import { useEffect, useRef, useState } from 'react';
import type { RulerLaneFormat } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { selectRulerLanes } from '../../stores/timeline/selectors';
import './TimelineControlsViewDropdown.css';

const LANE_OPTIONS: { format: RulerLaneFormat; label: string }[] = [
  { format: 'time', label: 'Time' },
  { format: 'timecode', label: 'Timecode' },
  { format: 'frames', label: 'Frames' },
  { format: 'bars', label: 'Bars + Beats' },
];

export function RulerLanesMenu() {
  const lanes = useTimelineStore(selectRulerLanes);
  // Select actions individually — they are stable references, so no re-render churn.
  const addRulerLane = useTimelineStore((state) => state.addRulerLane);
  const removeRulerLane = useTimelineStore((state) => state.removeRulerLane);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleFormat = (format: RulerLaneFormat) => {
    const existing = lanes.find((lane) => lane.format === format);
    if (existing) {
      removeRulerLane(existing.id);
    } else {
      addRulerLane(format);
    }
  };

  return (
    <div className="view-dropdown ruler-lanes-menu" ref={containerRef}>
      <button
        className={`btn btn-sm ${open ? 'btn-active' : ''}`}
        onClick={() => setOpen((previous) => !previous)}
        title="Ruler lanes"
      >
        Rulers
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="view-dropdown-menu">
          {LANE_OPTIONS.map((option) => {
            const enabled = lanes.some((lane) => lane.format === option.format);
            return (
              <div
                key={option.format}
                className={`view-dropdown-item ${enabled ? 'active' : ''}`}
                onClick={() => toggleFormat(option.format)}
              >
                <span className={`view-check ${enabled ? 'checked' : ''}`}>✓</span>
                <span>{option.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

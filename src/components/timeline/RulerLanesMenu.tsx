// Ruler-lanes checklist menu (issue #257, Packet 5).
//
// A small dropdown in the ruler-header control strip that toggles which ruler
// formats are stacked. Each format is unique (the store enforces it), so this is
// an ordered checklist: checking adds a lane, unchecking removes it. Reuses the
// existing view-dropdown styling for consistency with the View menu.

import { Fragment, useEffect, useRef, useState } from 'react';
import type { RulerLaneFormat } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { selectRulerLanes, selectTimelineGridSubdivision } from '../../stores/timeline/selectors';
import {
  TIMELINE_GRID_SUBDIVISIONS,
  TIMELINE_GRID_SUBDIVISION_LABELS,
} from '../../timeline/tempo/barsGrid';
import './TimelineControlsViewDropdown.css';

const LANE_OPTIONS: { format: RulerLaneFormat; label: string }[] = [
  { format: 'time', label: 'Time' },
  { format: 'timecode', label: 'Timecode' },
  { format: 'frames', label: 'Frames' },
  { format: 'bars', label: 'Bars + Beats' },
  { format: 'tempo', label: 'Tempo' },
];

export function RulerLanesMenu() {
  const lanes = useTimelineStore(selectRulerLanes);
  const gridSubdivision = useTimelineStore(selectTimelineGridSubdivision);
  const setTimelineGridSubdivision = useTimelineStore((state) => state.setTimelineGridSubdivision);
  // Select actions individually — they are stable references, so no re-render churn.
  const addRulerLane = useTimelineStore((state) => state.addRulerLane);
  const removeRulerLane = useTimelineStore((state) => state.removeRulerLane);

  const [open, setOpen] = useState(false);
  // Collapsed by default: the grid resolution is a detail of the bars lane, not
  // a peer of the lane list.
  const [gridOpen, setGridOpen] = useState(false);
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
            // Only the bars lane owns a sub-setting: the grid resolution the
            // body grid draws and snaps to (§3.5).
            const ownsGrid = option.format === 'bars';
            return (
              <Fragment key={option.format}>
                <div
                  className={`view-dropdown-item ${enabled ? 'active' : ''}`}
                  onClick={() => toggleFormat(option.format)}
                >
                  <span className={`view-check ${enabled ? 'checked' : ''}`}>✓</span>
                  <span className="ruler-lane-label">{option.label}</span>
                  {ownsGrid && (
                    // The row itself stays a pure toggle; expanding is a
                    // separate affordance so one click never means two things.
                    <button
                      type="button"
                      className="ruler-lane-expander"
                      title={gridOpen ? 'Hide grid resolution' : 'Grid resolution'}
                      aria-label="Grid resolution"
                      aria-expanded={gridOpen}
                      onClick={(event) => {
                        event.stopPropagation();
                        setGridOpen((previous) => !previous);
                      }}
                    >
                      {gridOpen ? '−' : '+'}
                    </button>
                  )}
                </div>
                {ownsGrid && gridOpen && TIMELINE_GRID_SUBDIVISIONS.map((subdivision) => (
                  <div
                    key={subdivision}
                    // Indented: these belong to Bars + Beats, not to the lane list.
                    className={`view-dropdown-item ruler-lane-subitem ${gridSubdivision === subdivision ? 'active' : ''}`}
                    onClick={() => setTimelineGridSubdivision(subdivision)}
                  >
                    <span className={`view-check ${gridSubdivision === subdivision ? 'checked' : ''}`}>✓</span>
                    <span className="ruler-lane-label">{TIMELINE_GRID_SUBDIVISION_LABELS[subdivision]}</span>
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

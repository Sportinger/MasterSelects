// Piano-roll snap toggle + grid division picker.
//
// Two controls, one concern: WHICH musical division the grid draws, and whether
// dragged notes land on it. The division applies to the drawn grid either way —
// turning snap off leaves the 1/16 lines visible to eye notes against, which is
// how every key editor behaves.
//
// Styled INLINE like the rest of the piano roll: this renders inside a detached
// popup window whose stylesheets are only mirrored as `<link>` tags, so app CSS
// classes are not reliably present in dev (see PianoRollRuler's header note).
//
// Pointer-focus hygiene (AGENTS §9): the toggle preventDefaults its mousedown so
// a click never leaves it focused, while keyboard Tab focus still lands on it
// with the native ring intact. The <select> keeps normal focus — a focused
// dropdown after choosing a value is expected behaviour.

import type { TimelineGridSubdivision } from '../../timeline/tempo/barsGrid';
import {
  TIMELINE_GRID_SUBDIVISIONS,
  TIMELINE_GRID_SUBDIVISION_LABELS,
} from '../../timeline/tempo/barsGrid';

const ACCENT = '#2d8ceb';

interface PianoRollSnapControlsProps {
  enabled: boolean;
  subdivision: TimelineGridSubdivision;
  onToggle: (enabled: boolean) => void;
  onSubdivisionChange: (subdivision: TimelineGridSubdivision) => void;
}

export function PianoRollSnapControls({
  enabled, subdivision, onToggle, onSubdivisionChange,
}: PianoRollSnapControlsProps) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: 2,
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, background: 'rgba(0,0,0,0.18)',
    }}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onToggle(!enabled)}
        aria-pressed={enabled}
        title={enabled
          ? 'Snap to grid is ON — hold Alt while dragging to place a note freely'
          : 'Snap to grid is OFF — hold Shift while dragging to snap'}
        style={{
          display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px',
          borderRadius: 3, cursor: 'pointer', fontSize: 11, fontWeight: 600,
          border: `1px solid ${enabled ? 'rgba(45,140,235,0.45)' : 'transparent'}`,
          background: enabled ? 'rgba(45,140,235,0.18)' : 'transparent',
          color: enabled ? ACCENT : 'rgba(255,255,255,0.72)',
        }}
      >
        Snap
      </button>
      <select
        value={subdivision}
        onChange={(e) => onSubdivisionChange(e.target.value as TimelineGridSubdivision)}
        title="Grid division — the lines the piano roll draws and snaps to"
        aria-label="Grid division"
        style={{
          height: 22, padding: '0 4px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
          border: '1px solid rgba(255,255,255,0.12)', background: '#1e1e1e',
          color: 'rgba(255,255,255,0.86)',
        }}
      >
        {TIMELINE_GRID_SUBDIVISIONS.map((option) => (
          <option key={option} value={option}>
            {TIMELINE_GRID_SUBDIVISION_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}

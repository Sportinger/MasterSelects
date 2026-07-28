// Metronome toggle + settings (issue #299, Packet 6).
//
// Sits immediately after the Rulers menu in the ruler-header control strip. The
// button itself toggles the click; the caret opens a small popover for volume
// and whether the click sounds every beat or only on bar downbeats.
//
// All of it is per-USER view state persisted in localStorage (plan §3.6) — the
// metronome is never part of the project.

import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import {
  selectMetronomeEnabled,
  selectMetronomeMode,
  selectMetronomeVolume,
} from '../../stores/timeline/selectors';
import './TimelineControlsViewDropdown.css';

export function MetronomeButton() {
  const enabled = useTimelineStore(selectMetronomeEnabled);
  const volume = useTimelineStore(selectMetronomeVolume);
  const mode = useTimelineStore(selectMetronomeMode);
  const toggleMetronome = useTimelineStore((state) => state.toggleMetronome);
  const setMetronomeVolume = useTimelineStore((state) => state.setMetronomeVolume);
  const setMetronomeMode = useTimelineStore((state) => state.setMetronomeMode);

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

  return (
    <div className="view-dropdown metronome-menu" ref={containerRef}>
      <button
        type="button"
        className={`btn btn-sm ${enabled ? 'btn-active' : ''}`}
        aria-label="Metronome"
        aria-pressed={enabled}
        onClick={toggleMetronome}
        title={enabled ? 'Metronome on — click follows the tempo map' : 'Metronome off'}
      >
        {/* Metronome glyph: the case plus its swinging pendulum. */}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M9 3h6l4 18H5L9 3z" strokeLinejoin="round" />
          <line x1="12" y1="21" x2="17" y2="7" />
        </svg>
      </button>
      <button
        type="button"
        className="metronome-settings-toggle"
        aria-label="Metronome settings"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        title="Metronome settings"
      >
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="view-dropdown-menu metronome-popover">
          <label className="metronome-volume">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Metronome volume"
              onChange={(event) => setMetronomeVolume(Number(event.target.value))}
            />
            <span className="metronome-volume-value">{Math.round(volume * 100)}%</span>
          </label>
          <div className="view-dropdown-divider" />
          {([
            { value: 'beats', label: 'Every beat' },
            { value: 'bars', label: 'Bars only' },
          ] as const).map((option) => (
            <div
              key={option.value}
              className={`view-dropdown-item ${mode === option.value ? 'active' : ''}`}
              onClick={() => setMetronomeMode(option.value)}
            >
              <span className={`view-check ${mode === option.value ? 'checked' : ''}`}>✓</span>
              <span>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

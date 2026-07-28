// Tempo editor lane (issue #299, Packet 3).
//
// The row under the Bars+Beats ruler that makes the tempo map editable: one flag
// per tempo/meter event, reading `4/4 - BPM = 120`. Editing replaces only the
// value being changed with a field — the rest of the label stays visible.
//
//   right-click the lane -> Add tempo / time signature change, inserted at the
//                           nearest bar with its editor already armed for typing
//   right-click a flag   -> Change tempo / time signature / Jump<->Ramp / Delete
//   drag a flag          -> move it, snapped to bars (Alt = free)
//
// Editing is menu-driven only: no double-click gesture, so a stray double-click
// on a flag can never open an editor.
//
// A RAMP event is reached by interpolation instead of a jump, so the lane draws
// a sloped indicator across the interval leading into it — rising for a speed-up,
// falling for a slow-down — and the flag carries the matching arrow.
//
// The first event is the project tempo: pinned at 0, not draggable, not
// deletable — its BPM and meter stay editable.
//
// Mesa-safe like every other lane: plain DOM positioned with dpr-aligned pixels,
// only the visible window is rendered, no canvas (see CLAUDE.md §9).
//
// Pointer discipline: the lane row this renders into already owns mousedown for
// ruler scrubbing, so every interactive element here stops propagation —
// otherwise dragging a flag would also drag the playhead.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { TempoEvent, TempoMap } from '../../../types/timeline';
import { useTimelineStore } from '../../../stores/timeline';
import { nearestBarTime } from '../../../timeline/tempo/barsGrid';
import { TIME_SIGNATURE_DENOMINATORS, tempoEventAt } from '../../../timeline/tempo/tempoEdits';
import { alignTimelineGridPixel } from '../utils/timelineGrid';

interface TempoRulerLaneProps {
  tempoMap: TempoMap;
  zoom: number;
  duration: number;
  visibleStartTime: number;
  visibleEndTime: number;
  devicePixelRatio: number;
}

type EditingMode = 'bpm' | 'meter';

interface EditingState {
  eventId: string;
  mode: EditingMode;
  value: string;
}

interface MenuState {
  /** null => the menu was opened on empty lane, so it offers insertion. */
  eventId: string | null;
  /** Where the right-click landed, for inserting at the nearest bar. */
  time: number;
  x: number;
  y: number;
}

interface DragState {
  eventId: string;
  pointerId: number;
  originClientX: number;
  originTime: number;
  previewTime: number;
  moved: boolean;
}

// A press that moves less than this is a click, not a drag — keeps double-click
// from committing a one-pixel move.
const DRAG_THRESHOLD_PX = 3;

// Trailing zeros are noise on a ruler flag; 128.5 keeps its half.
function formatBpm(bpm: number): string {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}

function formatMeter(event: TempoEvent): string {
  return `${event.numerator}/${event.denominator}`;
}

function parseMeter(raw: string): { numerator: number; denominator: number } | null {
  const match = raw.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || numerator < 1) return null;
  if (!(TIME_SIGNATURE_DENOMINATORS as readonly number[]).includes(denominator)) return null;
  return { numerator, denominator };
}

export function TempoRulerLane({
  tempoMap,
  zoom,
  duration,
  visibleStartTime,
  visibleEndTime,
  devicePixelRatio,
}: TempoRulerLaneProps) {
  const addTempoChange = useTimelineStore((state) => state.addTempoChange);
  const updateTempoChange = useTimelineStore((state) => state.updateTempoChange);
  const removeTempoChange = useTimelineStore((state) => state.removeTempoChange);

  const laneRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Dismiss on any press outside the menu, and on Escape. CAPTURE phase is
  // required: plenty of timeline elements (including the tempo flags) stop
  // mousedown propagation, so a bubble-phase listener would simply never fire
  // and the menu would stay open. The containment check keeps the menu's own
  // buttons alive — closing on their mousedown would unmount them before the
  // click landed.
  useEffect(() => {
    if (!menu) return undefined;

    const closeOnOutsidePress = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };

    document.addEventListener('mousedown', closeOnOutsidePress, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [menu]);

  const projectTempoId = tempoMap.events[0]?.id;
  const timeToPixel = (time: number) => alignTimelineGridPixel(time * zoom, devicePixelRatio);

  const timeAtClientX = (clientX: number): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(duration, (clientX - rect.left) / Math.max(zoom, 0.001)));
  };

  // ─── insert ──────────────────────────────────────────────────────────

  // Tempo and meter live on ONE event (plan §3.2), so both menu entries insert
  // the same flag — they differ only in which value they arm for typing.
  const insertEventAt = (rawTime: number, mode: EditingMode) => {
    const time = nearestBarTime(tempoMap, rawTime);
    // A new flag continues whatever is already in effect there, so inserting one
    // changes nothing until it is edited. Meter is inherited by tempoEdits.
    const inherited = tempoEventAt(tempoMap, time);
    const eventId = addTempoChange(time, inherited.bpm);
    setMenu(null);
    // Adding a change is always followed by typing one, so the new flag opens
    // ARMED: its editor is focused with the inherited value selected, so the
    // first keystroke replaces it. Esc leaves the flag at what it inherited,
    // which changes nothing.
    if (eventId) {
      setEditing({
        eventId,
        mode,
        value: mode === 'bpm' ? String(inherited.bpm) : formatMeter(inherited),
      });
    }
  };

  // ─── drag to move ────────────────────────────────────────────────────

  const beginDrag = (tempoEvent: TempoEvent, event: ReactPointerEvent<HTMLDivElement>) => {
    // The project tempo is pinned at 0.
    if (tempoEvent.id === projectTempoId) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      eventId: tempoEvent.id,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originTime: tempoEvent.time,
      previewTime: tempoEvent.time,
      moved: false,
    });
  };

  const continueDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    const deltaSeconds = (event.clientX - drag.originClientX) / Math.max(zoom, 0.001);
    const rawTime = Math.max(0, drag.originTime + deltaSeconds);
    // Alt frees the flag from the bar grid, matching the clip-drag convention.
    const nextTime = event.altKey ? rawTime : nearestBarTime(tempoMap, rawTime);
    setDrag({
      ...drag,
      previewTime: nextTime,
      moved: drag.moved || Math.abs(event.clientX - drag.originClientX) > DRAG_THRESHOLD_PX,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    // One store write for the whole gesture, so the drag is a single undo entry.
    if (drag.moved && drag.previewTime !== drag.originTime) {
      updateTempoChange(drag.eventId, { time: drag.previewTime });
    }
    setDrag(null);
  };

  // ─── inline editing ──────────────────────────────────────────────────

  const openEditor = (tempoEvent: TempoEvent, mode: EditingMode) => {
    setMenu(null);
    setEditing({
      eventId: tempoEvent.id,
      mode,
      value: mode === 'bpm'
        ? String(tempoEvent.bpm)
        : `${tempoEvent.numerator}/${tempoEvent.denominator}`,
    });
  };

  const commitEditor = () => {
    if (!editing) return;
    if (editing.mode === 'bpm') {
      const bpm = Number(editing.value);
      if (Number.isFinite(bpm)) updateTempoChange(editing.eventId, { bpm });
    } else {
      const meter = parseMeter(editing.value);
      if (meter) updateTempoChange(editing.eventId, meter);
    }
    setEditing(null);
  };

  const renderEditorInput = (mode: EditingMode) => (
    <input
      className={`tempo-flag-input ${mode}`}
      autoFocus
      // Select on focus so typing replaces the current value instead of
      // appending to it — the point of arming the editor.
      onFocus={(event) => event.currentTarget.select()}
      value={editing?.value ?? ''}
      inputMode={mode === 'bpm' ? 'decimal' : 'text'}
      aria-label={mode === 'bpm' ? 'Tempo in BPM' : 'Time signature'}
      onChange={(event) => setEditing(editing ? { ...editing, value: event.target.value } : null)}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={commitEditor}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitEditor();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(null);
        }
        event.stopPropagation();
      }}
    />
  );

  // Each ramp spans from the previous event to its own position; the slope sign
  // is the direction of the tempo change, so the shape reads at a glance.
  const rampSpans = tempoMap.events
    .map((tempoEvent, index) => ({ tempoEvent, previous: tempoMap.events[index - 1] }))
    .filter(({ tempoEvent, previous }) => (
      tempoEvent.curve === 'ramp'
      && previous !== undefined
      && tempoEvent.time > visibleStartTime
      && previous.time < visibleEndTime
    ))
    .map(({ tempoEvent, previous }) => ({
      id: tempoEvent.id,
      fromTime: previous!.time,
      toTime: tempoEvent.time,
      rising: tempoEvent.bpm >= previous!.bpm,
    }));

  const visibleEvents = tempoMap.events.filter((tempoEvent) => {
    const time = drag?.eventId === tempoEvent.id ? drag.previewTime : tempoEvent.time;
    return time >= visibleStartTime && time <= visibleEndTime;
  });

  return (
    <div
      ref={laneRef}
      className="tempo-lane-surface"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({ eventId: null, time: timeAtClientX(event.clientX), x: event.clientX, y: event.clientY });
      }}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {rampSpans.map((span) => {
        const left = timeToPixel(span.fromTime);
        const width = Math.max(2, timeToPixel(span.toTime) - left);
        return (
          <svg
            key={`ramp-${span.id}`}
            className="tempo-ramp-indicator"
            style={{ left, width }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1="0"
              y1={span.rising ? '90' : '10'}
              x2="100"
              y2={span.rising ? '10' : '90'}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      })}
      {visibleEvents.map((tempoEvent) => {
        const isProjectTempo = tempoEvent.id === projectTempoId;
        const time = drag?.eventId === tempoEvent.id ? drag.previewTime : tempoEvent.time;
        const isEditing = editing?.eventId === tempoEvent.id;
        const eventIndex = tempoMap.events.indexOf(tempoEvent);
        const isRamp = tempoEvent.curve === 'ramp' && eventIndex > 0;
        const rampRising = isRamp && tempoEvent.bpm >= tempoMap.events[eventIndex - 1].bpm;

        return (
          <div
            key={tempoEvent.id}
            className={`tempo-flag${isProjectTempo ? ' is-project-tempo' : ''}${isRamp ? ' is-ramp' : ''}${drag?.eventId === tempoEvent.id ? ' is-dragging' : ''}`}
            style={{ left: timeToPixel(time) }}
            title={isProjectTempo
              ? 'Project tempo — right-click to change tempo or time signature'
              : 'Drag to move (Alt for free placement) — right-click to edit'}
            onPointerDown={(event) => beginDrag(tempoEvent, event)}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({
                eventId: tempoEvent.id,
                time: tempoEvent.time,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            {isRamp && (
              <span className="tempo-flag-ramp" aria-label="Reached by ramp">
                {rampRising ? '↗' : '↘'}
              </span>
            )}
            {/* Only the VALUE being edited turns into a field; the rest of the
                flag stays readable, so you never lose sight of what you are
                editing or of the other half of the label. */}
            {isEditing && editing.mode === 'meter' ? (
              renderEditorInput('meter')
            ) : (
              <span className="tempo-flag-meter">{formatMeter(tempoEvent)}</span>
            )}
            <span className="tempo-flag-separator"> - BPM = </span>
            {isEditing && editing.mode === 'bpm' ? (
              renderEditorInput('bpm')
            ) : (
              <span className="tempo-flag-bpm">{formatBpm(tempoEvent.bpm)}</span>
            )}
          </div>
        );
      })}

      {menu && (() => {
        const target = menu.eventId
          ? tempoMap.events.find((candidate) => candidate.id === menu.eventId)
          : undefined;
        const isProjectTempo = Boolean(target) && target!.id === projectTempoId;
        // MUST portal to the body: this lane lives inside `.time-ruler`, which
        // carries a transform (so `position: fixed` would resolve against IT,
        // not the viewport) and sits in two `overflow: hidden` wrappers that
        // would clip the menu away entirely. Same pattern as TrackContextMenu.
        return createPortal(
          <div
            ref={menuRef}
            className="tempo-flag-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {target ? (
              <>
                <button type="button" onClick={() => openEditor(target, 'bpm')}>
                  Change tempo
                </button>
                <button type="button" onClick={() => openEditor(target, 'meter')}>
                  Change time signature
                </button>
                <button
                  type="button"
                  // The project tempo has nothing before it to glide from.
                  disabled={isProjectTempo}
                  title={isProjectTempo
                    ? 'The project tempo has no previous tempo to ramp from'
                    : 'Ramp: glide from the previous tempo instead of jumping'}
                  onClick={() => {
                    updateTempoChange(target.id, {
                      curve: target.curve === 'ramp' ? 'jump' : 'ramp',
                    });
                    setMenu(null);
                  }}
                >
                  <span className={`tempo-menu-check ${target.curve === 'ramp' ? 'checked' : ''}`}>✓</span>
                  Ramp from previous tempo
                </button>
                <button
                  type="button"
                  // The project tempo cannot be deleted — the map is never empty.
                  disabled={isProjectTempo}
                  title={isProjectTempo ? 'The project tempo cannot be deleted' : undefined}
                  onClick={() => {
                    removeTempoChange(target.id);
                    setMenu(null);
                  }}
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => insertEventAt(menu.time, 'bpm')}>
                  Add tempo change
                </button>
                <button type="button" onClick={() => insertEventAt(menu.time, 'meter')}>
                  Add time signature change
                </button>
              </>
            )}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}

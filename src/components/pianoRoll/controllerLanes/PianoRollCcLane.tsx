// CC automation lane (#298, plan §6C). A breakpoint-envelope editor for one of the
// four performed lanes (cutoff / mod / expression / pitch bend), stored on
// `clip.automation` as time-based breakpoints in CONTENT time (the same base as
// note.start). Unlike the velocity lane (a per-note property), this is genuinely
// new continuous-curve editing: click empty space to add a point, drag a point to
// move it (live, one undo per gesture), right-click to delete.
//
// Rendered as SVG (DOM, not <canvas>) so it composites reliably on Linux/Mesa
// (CLAUDE.md §9) and hit-testing points is trivial. It reads the clip's automation
// straight from the timeline store by clipId, so wiring it needs no PianoRoll.tsx
// changes — the lane is self-contained in the controller area.

import { useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import {
  clipLocalToContentTime,
  contentTimeToClipLocal,
  type MidiClipWindow,
} from '../../../services/midi/midiClipTiming';
import type { AutomationPoint } from '../../../types/midiClip';
import {
  laneDisplayValue,
  laneValueRange,
  type LaneTypeDescriptor,
} from './pianoRollLaneTypes';

const EMPTY_POINTS: readonly AutomationPoint[] = [];
const POINT_R = 4;      // visible radius
const HIT_R = 8;        // invisible hit radius (easier to grab)

interface PianoRollCcLaneProps {
  clipId: string;
  lane: LaneTypeDescriptor;   // a `kind: 'cc'` descriptor (has automationKey)
  effWindow: MidiClipWindow;
  pxPerSec: number;
  marginPx: number;
  laneInnerH: number;
  gridWidth: number;
  onReadoutChange?: (display: number | null) => void;
}

export function PianoRollCcLane({
  clipId, lane, effWindow, pxPerSec, marginPx, laneInnerH, gridWidth, onReadoutChange,
}: PianoRollCcLaneProps) {
  const key = lane.automationKey!;
  const points = useTimelineStore((s) => {
    const clip = s.clips.find((c) => c.id === clipId);
    return clip?.automation?.[key]?.points ?? EMPTY_POINTS;
  });
  const setLane = useTimelineStore((s) => s.setMidiClipAutomationLane);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [vMin, vMax] = laneValueRange(lane);
  const span = vMax - vMin;

  const xOf = (time: number) => marginPx + contentTimeToClipLocal(effWindow, time) * pxPerSec;
  const yOf = (value: number) => laneInnerH * (1 - (value - vMin) / span);
  const timeOf = (x: number) =>
    clamp(clipLocalToContentTime(effWindow, (x - marginPx) / pxPerSec), effWindow.inPoint, effWindow.outPoint);
  const valueOf = (y: number) => clamp(vMax - (y / Math.max(1, laneInnerH)) * span, vMin, vMax);

  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Drag an existing point: snapshot the sorted array + index so re-sorting during
  // the gesture can't lose the point being moved (the setter re-sorts for storage).
  const onPointDown = (e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const snapshot = points.slice();
    const doc = svgRef.current?.ownerDocument ?? document;
    let moved = false;

    const apply = (ev: MouseEvent, capture: boolean) => {
      const { x, y } = localXY(ev);
      const next = snapshot.map((p, i) => (i === index ? { time: timeOf(x), value: valueOf(y) } : p));
      setLane(clipId, key, next, { captureHistory: capture });
      onReadoutChange?.(laneDisplayValue(lane, valueOf(y)));
    };
    const onMove = (ev: MouseEvent) => { moved = true; apply(ev, false); };
    const onUp = (ev: MouseEvent) => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      onReadoutChange?.(null);
      if (moved) apply(ev, true); // one committing snapshot for the whole drag
    };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  };

  // Click on empty lane → add a breakpoint (single undo step).
  const onBackgroundDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const { x, y } = localXY(e);
    setLane(clipId, key, [...points, { time: timeOf(x), value: valueOf(y) }]);
  };

  const onPointContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setLane(clipId, key, points.filter((_, i) => i !== index));
  };

  // Curve: horizontal stub from the window's left edge to the first point, the
  // breakpoint polyline, then a stub to the right edge (flat-hold, matching bake).
  const leftX = xOf(effWindow.inPoint);
  const rightX = xOf(effWindow.outPoint);
  const linePts: string[] = [];
  if (points.length > 0) {
    linePts.push(`${leftX},${yOf(points[0].value)}`);
    for (const p of points) linePts.push(`${xOf(p.time)},${yOf(p.value)}`);
    linePts.push(`${rightX},${yOf(points[points.length - 1].value)}`);
  }
  const zeroY = lane.bipolar ? yOf(0) : null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <svg
        ref={svgRef}
        width={gridWidth}
        height={laneInnerH}
        onMouseDown={onBackgroundDown}
        style={{ position: 'absolute', top: 0, left: 0, cursor: 'crosshair', display: 'block' }}
      >
        {/* Bipolar center line (pitch bend = 0). */}
        {zeroY !== null && (
          <line x1={leftX} y1={zeroY} x2={rightX} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
        )}
        {points.length > 0 && (
          <polyline points={linePts.join(' ')} fill="none" stroke={lane.color ?? '#7fbfff'} strokeWidth={1.5} />
        )}
        {points.map((p, i) => (
          <g key={i}>
            {/* Invisible larger hit target for easy grabbing. */}
            <circle
              cx={xOf(p.time)} cy={yOf(p.value)} r={HIT_R} fill="transparent"
              style={{ cursor: 'move' }}
              onMouseDown={(e) => onPointDown(e, i)}
              onContextMenu={(e) => onPointContextMenu(e, i)}
            />
            <circle cx={xOf(p.time)} cy={yOf(p.value)} r={POINT_R} fill={lane.color ?? '#7fbfff'} stroke="#000" strokeWidth={0.75} pointerEvents="none" />
          </g>
        ))}
      </svg>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// Custom overlay scrollbars + zoom buttons for the piano roll (#249).
//
// We keep the grid's native scroll *engine* (overflow:auto on the passed
// element) — that's what makes wheel scrolling, the cursor-anchored zoom math,
// and the sticky keyboard column keep working — but hide the native bars and
// draw our own here, Cubase-style: a horizontal bar along the bottom and a
// vertical bar down the right, each with a draggable thumb and a pair of zoom
// −/+ buttons at its far end. Dragging a thumb just drives the element's
// scrollLeft/scrollTop, so the real scroll position stays the source of truth;
// the buttons call back into the parent's two-axis zoom.

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

export const PIANO_ROLL_SCROLLBAR = 12; // px thickness of each bar
const MIN_THUMB = 24;                   // px, so the thumb stays grabbable
const ZOOM_BTN = 16;                    // px extent of each zoom button along the bar
const RESERVE = ZOOM_BTN * 2;           // bar length taken by the two buttons

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Thumb length over a visual track of `track` px, given viewport/content sizes.
function thumbLength(track: number, viewport: number, content: number): number {
  if (content <= viewport || track <= 0) return Math.max(0, track);
  return Math.max(MIN_THUMB, (track * viewport) / content);
}

interface Metrics {
  sx: number; sy: number;   // scroll offset
  vw: number; vh: number;   // viewport (client) size
  sw: number; sh: number;   // scroll content size
}

interface PianoRollScrollbarsProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  // Content dimensions drive re-measurement when zoom changes the grid size.
  contentWidth: number;
  contentHeight: number;
  onZoomTime: (dir: 1 | -1) => void;
  onZoomNotes: (dir: 1 | -1) => void;
}

export function PianoRollScrollbars({
  scrollRef, contentWidth, contentHeight, onZoomTime, onZoomNotes,
}: PianoRollScrollbarsProps) {
  const [m, setM] = useState<Metrics>({ sx: 0, sy: 0, vw: 0, vh: 0, sw: 0, sh: 0 });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setM({
      sx: el.scrollLeft, sy: el.scrollTop,
      vw: el.clientWidth, vh: el.clientHeight,
      sw: el.scrollWidth, sh: el.scrollHeight,
    });
  }, [scrollRef]);

  // Track live scroll position and viewport resizes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [scrollRef, measure]);

  // Re-measure after a zoom resizes the content (scrollWidth/Height changed).
  useLayoutEffect(() => { measure(); }, [contentWidth, contentHeight, measure]);

  // Drag a thumb: map its travel over the visual track to the scroll range.
  const startDrag = useCallback((axis: 'h' | 'v', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const horizontal = axis === 'h';
    const startPos = horizontal ? e.clientX : e.clientY;
    const startScroll = horizontal ? el.scrollLeft : el.scrollTop;
    const viewport = horizontal ? el.clientWidth : el.clientHeight;
    const content = horizontal ? el.scrollWidth : el.scrollHeight;
    const track = viewport - RESERVE;
    const maxScroll = Math.max(0, content - viewport);
    const thumbTravel = track - thumbLength(track, viewport, content);

    const onMove = (ev: PointerEvent) => {
      const delta = (horizontal ? ev.clientX : ev.clientY) - startPos;
      const next = thumbTravel > 0
        ? clamp(startScroll + (delta / thumbTravel) * maxScroll, 0, maxScroll)
        : startScroll;
      if (horizontal) el.scrollLeft = next; else el.scrollTop = next;
    };
    const onUp = () => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
    };
    // Listen on the popup's own document (the grid lives in a detached window).
    const doc = el.ownerDocument;
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
  }, [scrollRef]);

  // Click an empty part of a track: center the thumb on the click point.
  const jumpTo = useCallback((axis: 'h' | 'v', e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const horizontal = axis === 'h';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const viewport = horizontal ? el.clientWidth : el.clientHeight;
    const content = horizontal ? el.scrollWidth : el.scrollHeight;
    const track = viewport - RESERVE;
    const maxScroll = Math.max(0, content - viewport);
    const thumb = thumbLength(track, viewport, content);
    const pos = (horizontal ? e.clientX - rect.left : e.clientY - rect.top) - thumb / 2;
    const thumbTravel = track - thumb;
    const next = thumbTravel > 0 ? clamp((pos / thumbTravel) * maxScroll, 0, maxScroll) : 0;
    if (horizontal) el.scrollLeft = next; else el.scrollTop = next;
  }, [scrollRef]);

  const hTrack = Math.max(0, m.vw - RESERVE);
  const hThumbLen = thumbLength(hTrack, m.vw, m.sw);
  const hMaxScroll = Math.max(0, m.sw - m.vw);
  const hThumbPos = hMaxScroll > 0 ? (m.sx / hMaxScroll) * (hTrack - hThumbLen) : 0;
  const hHasOverflow = m.sw > m.vw + 1;

  const vTrack = Math.max(0, m.vh - RESERVE);
  const vThumbLen = thumbLength(vTrack, m.vh, m.sh);
  const vMaxScroll = Math.max(0, m.sh - m.vh);
  const vThumbPos = vMaxScroll > 0 ? (m.sy / vMaxScroll) * (vTrack - vThumbLen) : 0;
  const vHasOverflow = m.sh > m.vh + 1;

  const trackBg = '#121212';
  const thumbBg = '#3a3a3a';

  const btnBase: React.CSSProperties = {
    position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, margin: 0, border: 'none', background: '#1d1d1d', color: '#aaa',
    fontSize: 12, lineHeight: 1, cursor: 'pointer', userSelect: 'none',
    outline: 'none', WebkitTapHighlightColor: 'transparent',
  };

  // Toolbar-style buttons must not retain focus, otherwise the focus ring stays
  // lit (and shows during unrelated Ctrl+wheel zooms). Prevent the press from
  // moving focus to the button.
  const preventFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <>
      {/* Horizontal scrollbar (bottom): track on the left, −/+ time zoom at the right end */}
      <div style={{
        position: 'absolute', left: 0, bottom: 0, right: PIANO_ROLL_SCROLLBAR,
        height: PIANO_ROLL_SCROLLBAR, background: trackBg, borderTop: '1px solid #222',
      }}>
        <div
          onPointerDown={(e) => jumpTo('h', e)}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: RESERVE }}
        >
          {hHasOverflow && (
            <div
              onPointerDown={(e) => startDrag('h', e)}
              style={{
                position: 'absolute', top: 2, height: PIANO_ROLL_SCROLLBAR - 4,
                left: hThumbPos, width: hThumbLen, background: thumbBg, borderRadius: 4, cursor: 'pointer',
              }}
            />
          )}
        </div>
        <button title="Zoom out (time)" onMouseDown={preventFocus} onClick={() => onZoomTime(-1)}
          style={{ ...btnBase, right: ZOOM_BTN, top: 0, bottom: 0, width: ZOOM_BTN, borderRight: '1px solid #111' }}>−</button>
        <button title="Zoom in (time)" onMouseDown={preventFocus} onClick={() => onZoomTime(1)}
          style={{ ...btnBase, right: 0, top: 0, bottom: 0, width: ZOOM_BTN }}>+</button>
      </div>

      {/* Vertical scrollbar (right): track on top, −/+ note-height zoom at the bottom end */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: PIANO_ROLL_SCROLLBAR,
        width: PIANO_ROLL_SCROLLBAR, background: trackBg, borderLeft: '1px solid #222',
      }}>
        <div
          onPointerDown={(e) => jumpTo('v', e)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: RESERVE }}
        >
          {vHasOverflow && (
            <div
              onPointerDown={(e) => startDrag('v', e)}
              style={{
                position: 'absolute', left: 2, width: PIANO_ROLL_SCROLLBAR - 4,
                top: vThumbPos, height: vThumbLen, background: thumbBg, borderRadius: 4, cursor: 'pointer',
              }}
            />
          )}
        </div>
        <button title="Zoom in (notes)" onMouseDown={preventFocus} onClick={() => onZoomNotes(1)}
          style={{ ...btnBase, bottom: ZOOM_BTN, left: 0, right: 0, height: ZOOM_BTN, borderBottom: '1px solid #111' }}>+</button>
        <button title="Zoom out (notes)" onMouseDown={preventFocus} onClick={() => onZoomNotes(-1)}
          style={{ ...btnBase, bottom: 0, left: 0, right: 0, height: ZOOM_BTN }}>−</button>
      </div>

      {/* Corner where the two bars meet */}
      <div style={{
        position: 'absolute', right: 0, bottom: 0,
        width: PIANO_ROLL_SCROLLBAR, height: PIANO_ROLL_SCROLLBAR, background: trackBg,
      }} />
    </>
  );
}

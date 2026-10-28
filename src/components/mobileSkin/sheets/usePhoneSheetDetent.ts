// Size and detent of the open sheet: caps from the visual viewport, the live sheet height published
// to the shell (the preview and the docked transport lay out from it), and the grab handle's drag,
// tap and arrow-key behaviour. Pure rules live in phoneSheetSizing.ts.

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import {
  PHONE_SHEET_LAYOUT, phoneSheetCap, phoneSheetCaps, phoneSheetGrowth, phoneSheetSettle, phoneSheetStep, phoneSheetStops, phoneSheetToggle,
  rememberPhoneSheetDetent, rememberedPhoneSheetDetent, type PhoneSheetCaps, type PhoneSheetDetent, type PhoneSheetSize,
} from './phoneSheetSizing';

/** Settled sheet height: the preview is sized from it. */
export const PHONE_SHEET_HEIGHT_VAR = '--phone-sheet-h';
/** Live sheet height, also while the handle is dragged: the docked transport follows it. */
export const PHONE_SHEET_LIVE_HEIGHT_VAR = '--phone-sheet-live-h';

/** How long a content-fit sheet follows its content after opening before its height holds still. */
const LOCK_AFTER_MS = 400;

interface DragState {
  pointerId: number;
  startY: number;
  startHeight: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  moved: boolean;
  natural: number;
}

/** The keyboard's cover of the shell (--phone-keyboard-inset, usePhoneViewport): the sheet sits above it. */
function keyboardInsetOf(shell: HTMLElement | null): number {
  if (!shell) return 0;
  const value = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--phone-keyboard-inset'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function measureCaps(shell: HTMLElement | null): PhoneSheetCaps {
  const shellHeight = shell?.getBoundingClientRect().height || window.visualViewport?.height || window.innerHeight;
  // The same room the layout uses (PhoneSheet.css): the sheet, transport and preview share what the
  // keyboard leaves, so the preview keeps its minimum share while typing too.
  const viewport = Math.max(0, shellHeight - keyboardInsetOf(shell));
  const topBar = shell?.querySelector<HTMLElement>('[data-testid="phone-top-bar"]');
  const shellTop = shell?.getBoundingClientRect().top ?? 0;
  const topStrips = topBar ? Math.max(0, topBar.getBoundingClientRect().bottom - shellTop) : 85;
  return phoneSheetCaps(viewport, topStrips, PHONE_SHEET_LAYOUT.transportPx);
}

/** Height of everything in the sheet if nothing were capped (header, handle and full body content). */
function naturalHeight(panel: HTMLElement, body: HTMLElement | null): number {
  if (!body) return panel.offsetHeight;
  return panel.offsetHeight - body.clientHeight + body.scrollHeight;
}

export interface PhoneSheetDetentApi {
  detent: PhoneSheetDetent;
  cap: number;
  grabberProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onClick: () => void;
  };
  /** Same drag on the header's free area (not on its buttons). */
  headerDragProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  };
}

export function usePhoneSheetDetent(
  panelRef: RefObject<HTMLDivElement | null>,
  bodyRef: RefObject<HTMLDivElement | null>,
  id: string | null,
  size: PhoneSheetSize,
  onCancel: () => void,
): PhoneSheetDetentApi {
  const [detent, setDetentState] = useState<PhoneSheetDetent>(() => rememberedPhoneSheetDetent(id));
  const [caps, setCaps] = useState<PhoneSheetCaps>(() => measureCaps(null));
  const drag = useRef<DragState | null>(null);
  const suppressClickUntil = useRef(0);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  const setDetent = useCallback((next: PhoneSheetDetent) => {
    setDetentState(next);
    rememberPhoneSheetDetent(id, next);
  }, [id]);

  const shellOf = () => panelRef.current?.closest<HTMLElement>('.phone-shell') ?? null;

  // Caps follow the visual viewport (keyboard, rotation, browser chrome) and the keyboard inset.
  useLayoutEffect(() => {
    const shell = shellOf();
    const update = () => setCaps((previous) => {
      const next = measureCaps(shell);
      return next.peek === previous.peek && next.tool === previous.tool && next.full === previous.full ? previous : next;
    });
    update();
    if (!shell || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    // The keyboard inset is a style variable on the shell: a change of it alone resizes nothing.
    const styleObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    styleObserver?.observe(shell, { attributes: true, attributeFilter: ['style'] });
    return () => {
      observer.disconnect();
      styleObserver?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the shell of a mounted sheet does not change
  }, []);

  const cap = phoneSheetCap(detent, size, caps);

  // Content-fit sheets get a max-height, 'fill' sheets a fixed height. A content-fit sheet takes its
  // content height while it opens (LOCK_AFTER_MS) and then keeps it while the user works in it: a value
  // label, a Reset button or a status line that comes and goes must not resize the preview being judged.
  // A detent or viewport change measures again; larger content a tap adds grows it (below). A drag
  // overrides inline.
  const lockRef = useRef<number | null>(null);
  const applySize = useCallback((nextCap: number, natural?: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.maxHeight = `${nextCap}px`;
    if (size === 'fill') {
      panel.style.height = `${nextCap}px`;
      return;
    }
    if (lockRef.current === null) {
      panel.style.height = '';
      return;
    }
    const content = natural ?? naturalHeight(panel, bodyRef.current);
    lockRef.current = Math.round(Math.min(content, nextCap));
    panel.style.height = `${lockRef.current}px`;
  }, [panelRef, bodyRef, size]);

  useLayoutEffect(() => {
    if (!drag.current) applySize(cap);
  }, [applySize, cap]);

  useLayoutEffect(() => {
    if (size === 'fill') return undefined;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || drag.current) return;
      lockRef.current = Math.round(panel.getBoundingClientRect().height);
      panel.style.height = `${lockRef.current}px`;
    }, LOCK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [panelRef, size]);

  // Content a tap adds after the lock (a style tab's panel, a "More" section) grows the sheet towards its
  // cap instead of opening below the fold (phoneSheetGrowth). Small changes keep the height.
  const capRef = useRef(cap);
  capRef.current = cap;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const body = bodyRef.current;
    if (size === 'fill' || !panel || !body || typeof MutationObserver === 'undefined') return undefined;
    let lastInput = -Infinity;
    let frame = 0;
    const markInput = () => { lastInput = performance.now(); };
    const check = () => {
      frame = 0;
      if (lockRef.current === null || drag.current) return;
      const next = phoneSheetGrowth({
        lock: lockRef.current,
        natural: naturalHeight(panel, body),
        cap: capRef.current,
        sinceInputMs: performance.now() - lastInput,
      });
      if (next === null) return;
      lockRef.current = next;
      panel.style.height = `${next}px`;
    };
    const schedule = () => { if (frame === 0) frame = window.requestAnimationFrame(check); };
    const observer = new MutationObserver(schedule);
    observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'aria-expanded'] });
    panel.addEventListener('pointerup', markInput, true);
    panel.addEventListener('keydown', markInput, true);
    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      panel.removeEventListener('pointerup', markInput, true);
      panel.removeEventListener('keydown', markInput, true);
    };
  }, [panelRef, bodyRef, size]);

  // Publish the rendered height to the shell: the preview and transport lay out above it.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const shell = shellOf();
    if (!panel || !shell) return undefined;
    const publish = () => {
      const height = `${Math.round(panel.getBoundingClientRect().height)}px`;
      shell.style.setProperty(PHONE_SHEET_LIVE_HEIGHT_VAR, height);
      if (!drag.current) shell.style.setProperty(PHONE_SHEET_HEIGHT_VAR, height);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(panel);
    return () => {
      observer?.disconnect();
      shell.style.removeProperty(PHONE_SHEET_HEIGHT_VAR);
      shell.style.removeProperty(PHONE_SHEET_LIVE_HEIGHT_VAR);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one observer per mounted sheet
  }, []);

  const stopsNow = () => {
    const panel = panelRef.current;
    return phoneSheetStops(size, caps, panel ? naturalHeight(panel, bodyRef.current) : cap);
  };

  const begin = (event: PointerEvent<HTMLElement>) => {
    const panel = panelRef.current;
    if (!panel || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panel.getBoundingClientRect().height,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false,
      natural: naturalHeight(panel, bodyRef.current),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    const panel = panelRef.current;
    if (!state || !panel || state.pointerId !== event.pointerId) return;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.abs(dy) < 6) return;
    state.moved = true;
    const dt = Math.max(1, event.timeStamp - state.lastTime);
    state.velocity = 0.7 * ((event.clientY - state.lastY) / dt) + 0.3 * state.velocity;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    const height = Math.max(0, Math.min(caps.full, state.startHeight - dy));
    panel.style.maxHeight = `${caps.full}px`;
    panel.style.height = `${height}px`;
  };

  const end = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const state = drag.current;
    const panel = panelRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!state.moved || !panel) return;
    suppressClickUntil.current = performance.now() + 400;
    const endHeight = panel.getBoundingClientRect().height;
    const stops = phoneSheetStops(size, caps, state.natural);
    const result = cancelled
      ? detent
      : phoneSheetSettle({ current: detent, stops, startHeight: state.startHeight, endHeight, velocity: state.velocity });
    if (result === 'close') {
      cancelRef.current();
      return;
    }
    if (size !== 'fill' && lockRef.current === null) lockRef.current = 0;
    applySize(phoneSheetCap(result, size, caps), state.natural);
    setDetent(result);
  };

  const fromHeader = (handler: (event: PointerEvent<HTMLElement>) => void) => (event: PointerEvent<HTMLElement>) => {
    if (event.type === 'pointerdown' && (event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    handler(event);
  };

  return {
    detent,
    cap,
    grabberProps: {
      onPointerDown: begin,
      onPointerMove: move,
      onPointerUp: (event) => {
        end(event, false);
        // Pointer-focus hygiene: a tapped handle lets go of focus; keyboard focus stays.
        const target = event.currentTarget;
        window.requestAnimationFrame(() => { if (document.activeElement === target) target.blur(); });
      },
      onPointerCancel: (event) => end(event, true),
      onKeyDown: (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        setDetent(phoneSheetStep(detent, stopsNow(), event.key === 'ArrowUp' ? 1 : -1));
      },
      onClick: () => {
        if (performance.now() < suppressClickUntil.current) return;
        setDetent(phoneSheetToggle(detent, stopsNow()));
      },
    },
    headerDragProps: {
      onPointerDown: fromHeader(begin),
      onPointerMove: move,
      onPointerUp: (event) => end(event, false),
      onPointerCancel: (event) => end(event, true),
    },
  };
}

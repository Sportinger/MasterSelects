import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  SHORTCUT_DISPLAY_PREVIEW_EVENT,
  type ShortcutDisplayPreviewDetail,
} from './shortcutDisplayPreview';
import './ShortcutDisplayOverlay.css';

type MouseButton = 'left' | 'middle' | 'right' | 'back' | 'forward';
type MousePressMode = 'click' | 'held';
type WheelDirection = 'up' | 'down' | 'left' | 'right';

interface ActiveKey {
  label: string;
  order: number;
}

interface PendingMouseGesture {
  button: MouseButton;
  entryId?: number;
  isDragging: boolean;
  labels: string[];
  startX: number;
  startY: number;
}

interface ShortcutDisplayEntry {
  id: number;
  durationMs: number;
  isExiting?: boolean;
  isHeld?: boolean;
  labels: string[];
  mouseAnimationId?: number;
  mouseButton?: MouseButton;
  mousePressMode?: MousePressMode;
  wheelDirection?: WheelDirection;
}

interface ShowEntryOptions {
  durationMs?: number;
  entryId?: number;
  hideAfterMs?: number;
  isHeld?: boolean;
  mousePressMode?: MousePressMode;
  onHide?: (entryId: number) => void;
}

const DEFAULT_DISPLAY_DURATION_MS = 1400;
const DRAG_DISTANCE_PX = 6;
const FADE_OUT_MS = 150;
const KEY_TAP_DISPLAY_DURATION_MS = 900;
const MOUSE_RELEASE_DISPLAY_DURATION_MS = 260;
const QUICK_DRAG_DISPLAY_DURATION_MS = 700;
const WHEEL_CONTINUITY_MS = 360;
const WHEEL_DISPLAY_DURATION_MS = 900;
const PREVIEW_LABELS = ['Ctrl', 'Shift', 'A'];
const MAX_HELD_KEY_LABELS = 4;
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Backspace: 'Backspace',
  Delete: 'Del',
  End: 'End',
  Enter: 'Enter',
  Escape: 'Esc',
  Home: 'Home',
  Insert: 'Insert',
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  Tab: 'Tab',
};

const CODE_LABELS: Record<string, string> = {
  NumpadAdd: 'Numpad +',
  NumpadDecimal: 'Numpad .',
  NumpadDivide: 'Numpad /',
  NumpadMultiply: 'Numpad *',
  NumpadSubtract: 'Numpad -',
};

function isMacPlatform(): boolean {
  return navigator.platform.toUpperCase().includes('MAC');
}

function getModifierLabels(event: KeyboardEvent | MouseEvent): string[] {
  const labels: string[] = [];
  if (event.ctrlKey) labels.push('Ctrl');
  if (event.metaKey) labels.push(isMacPlatform() ? 'Cmd' : 'Win');
  if (event.altKey) labels.push(isMacPlatform() ? 'Option' : 'Alt');
  if (event.shiftKey) labels.push('Shift');
  return labels;
}

function formatCodeLabel(code: string): string {
  if (CODE_LABELS[code]) {
    return CODE_LABELS[code];
  }
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3).toUpperCase();
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5);
  }
  if (code.startsWith('Numpad') && code.length > 6) {
    return `Numpad ${code.slice(6)}`;
  }
  return code || 'Key';
}

function formatKeyLabel(event: KeyboardEvent): string {
  if (KEY_LABELS[event.key]) {
    return KEY_LABELS[event.key];
  }
  if (!event.key || event.key === 'Unidentified') {
    return formatCodeLabel(event.code);
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase();
  }
  return event.key;
}

function formatActiveKeyLabel(event: KeyboardEvent): string {
  if (!isModifierKey(event)) {
    return formatKeyLabel(event);
  }
  switch (event.key) {
    case 'Alt':
      return isMacPlatform() ? 'Option' : 'Alt';
    case 'Control':
      return 'Ctrl';
    case 'Meta':
      return isMacPlatform() ? 'Cmd' : 'Win';
    case 'Shift':
      return 'Shift';
    default:
      return formatKeyLabel(event);
  }
}

function getKeyIdentity(event: KeyboardEvent): string {
  return event.code || event.key;
}

function isModifierKey(event: KeyboardEvent): boolean {
  return MODIFIER_KEYS.has(event.key);
}

function mouseButtonFromEvent(event: MouseEvent): MouseButton | null {
  switch (event.button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    case 3:
      return 'back';
    case 4:
      return 'forward';
    default:
      return null;
  }
}

function wheelDirectionFromEvent(event: WheelEvent): WheelDirection | null {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    if (event.deltaX > 0) return 'right';
    if (event.deltaX < 0) return 'left';
    return null;
  }
  if (event.deltaY > 0) return 'down';
  if (event.deltaY < 0) return 'up';
  return null;
}

function wheelDirectionLabel(direction: WheelDirection): string {
  switch (direction) {
    case 'up':
      return 'Scroll Up';
    case 'down':
      return 'Scroll Down';
    case 'left':
      return 'Scroll Left';
    case 'right':
      return 'Scroll Right';
  }
}

function mouseDragLabel(button: MouseButton): string {
  switch (button) {
    case 'left':
      return 'Drag';
    case 'middle':
      return 'Drag';
    case 'right':
      return 'Drag';
    case 'back':
      return 'Mouse Back Drag';
    case 'forward':
      return 'Mouse Forward Drag';
  }
}

function canShowMouseGlyph(button: MouseButton): button is 'left' | 'middle' | 'right' {
  return button === 'left' || button === 'middle' || button === 'right';
}

function hasDragged(startX: number, startY: number, currentX: number, currentY: number): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= DRAG_DISTANCE_PX;
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (seen.has(label)) {
      return false;
    }
    seen.add(label);
    return true;
  });
}

function MouseGlyph({
  activeButton,
  animationId,
  mode,
}: {
  activeButton: 'left' | 'middle' | 'right';
  animationId: number;
  mode: MousePressMode;
}) {
  const getButtonClassName = (button: 'left' | 'middle' | 'right') => [
    'shortcut-display-mouse-button',
    activeButton === button ? `shortcut-display-mouse-button--${mode}` : '',
  ].filter(Boolean).join(' ');
  const getButtonKey = (button: 'left' | 'middle' | 'right') => (
    activeButton === button ? `${button}-${mode}-${animationId}` : button
  );

  return (
    <span className="shortcut-display-mouse" aria-hidden="true">
      <span className={getButtonClassName('left')} key={getButtonKey('left')} />
      <span className={getButtonClassName('middle')} key={getButtonKey('middle')} />
      <span className={getButtonClassName('right')} key={getButtonKey('right')} />
      <span className="shortcut-display-mouse-body" />
    </span>
  );
}

function WheelGlyph({ direction }: { direction: WheelDirection }) {
  return (
    <span className={`shortcut-display-wheel shortcut-display-wheel--${direction}`} aria-hidden="true">
      <span className="shortcut-display-wheel-track">
        <span className="shortcut-display-wheel-dot" />
      </span>
      <span className="shortcut-display-wheel-label">{direction}</span>
    </span>
  );
}

export function ShortcutDisplayOverlay() {
  const showShortcutDisplay = useSettingsStore((state) => state.showShortcutDisplay);
  const shortcutDisplayScale = useSettingsStore((state) => state.shortcutDisplayScale);
  const [entry, setEntry] = useState<ShortcutDisplayEntry | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const entryIdRef = useRef(0);
  const pressedKeysRef = useRef<Map<string, ActiveKey>>(new Map());
  const keyboardEntryIdRef = useRef<number | null>(null);
  const pendingMouseGestureRef = useRef<PendingMouseGesture | null>(null);
  const keyOrderRef = useRef(0);
  const lastWheelRef = useRef<{ entryId: number; time: number } | null>(null);
  const mouseAnimationIdRef = useRef(0);

  const clearEntryTimers = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const startEntryExit = useCallback((id: number) => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setEntry((current) => (
      current?.id === id
        ? { ...current, isExiting: true, isHeld: false }
        : current
    ));
    exitTimerRef.current = window.setTimeout(() => {
      setEntry((current) => (current?.id === id ? null : current));
      exitTimerRef.current = null;
    }, FADE_OUT_MS);
  }, []);

  const showEntry = useCallback((
    data: Omit<ShortcutDisplayEntry, 'id' | 'durationMs'>,
    options: ShowEntryOptions = {},
  ) => {
    clearEntryTimers();
    const id = options.entryId ?? entryIdRef.current + 1;
    entryIdRef.current = Math.max(entryIdRef.current, id);
    const durationMs = options.durationMs ?? DEFAULT_DISPLAY_DURATION_MS;
    setEntry({ ...data, id, durationMs, isExiting: false, isHeld: options.isHeld });

    const hideAfterMs = options.hideAfterMs ?? (options.isHeld ? null : durationMs);
    if (hideAfterMs !== null) {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        if (options.onHide) {
          options.onHide(id);
        } else {
          startEntryExit(id);
        }
      }, hideAfterMs);
    }

    return id;
  }, [clearEntryTimers, startEntryExit]);

  useEffect(() => () => {
    clearEntryTimers();
  }, [clearEntryTimers]);

  const getHeldKeyLabels = useCallback(() => (
    Array.from(pressedKeysRef.current.values())
      .toSorted((a, b) => a.order - b.order)
      .slice(0, MAX_HELD_KEY_LABELS)
      .map((key) => key.label)
  ), []);

  const showHeldKeyboardEntry = useCallback((entryId?: number) => {
    const labels = getHeldKeyLabels();
    const currentEntryId = entryId ?? keyboardEntryIdRef.current ?? undefined;
    if (labels.length === 0) {
      if (currentEntryId !== undefined) {
        startEntryExit(currentEntryId);
      }
      keyboardEntryIdRef.current = null;
      return null;
    }

    const nextEntryId = showEntry({ labels }, {
      entryId: currentEntryId,
      isHeld: true,
    });
    keyboardEntryIdRef.current = nextEntryId;
    return nextEntryId;
  }, [getHeldKeyLabels, showEntry, startEntryExit]);

  const restoreHeldKeyboardEntry = useCallback((entryId: number) => {
    if (pressedKeysRef.current.size > 0) {
      showHeldKeyboardEntry(entryId);
      return;
    }
    keyboardEntryIdRef.current = null;
    startEntryExit(entryId);
  }, [showHeldKeyboardEntry, startEntryExit]);

  const getPointerPrefixLabels = useCallback((event: MouseEvent | WheelEvent) => uniqueLabels([
    ...getModifierLabels(event),
    ...getHeldKeyLabels(),
  ]), [getHeldKeyLabels]);

  const getPointerComboLabels = useCallback((
    event: MouseEvent | WheelEvent,
    actionLabel: string,
  ) => uniqueLabels([
    ...getPointerPrefixLabels(event),
    actionLabel,
  ]), [getPointerPrefixLabels]);

  useEffect(() => {
    const handlePreviewRequest = (event: Event) => {
      const detail = (event as CustomEvent<ShortcutDisplayPreviewDetail>).detail;
      showEntry(
        {
          labels: PREVIEW_LABELS,
          mouseAnimationId: mouseAnimationIdRef.current + 1,
          mouseButton: 'left',
          mousePressMode: 'click',
        },
        { durationMs: detail?.durationMs ?? DEFAULT_DISPLAY_DURATION_MS },
      );
      mouseAnimationIdRef.current += 1;
    };

    window.addEventListener(SHORTCUT_DISPLAY_PREVIEW_EVENT, handlePreviewRequest);
    return () => {
      window.removeEventListener(SHORTCUT_DISPLAY_PREVIEW_EVENT, handlePreviewRequest);
    };
  }, [showEntry]);

  useEffect(() => {
    if (!showShortcutDisplay) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }
      const identity = getKeyIdentity(event);
      if (!pressedKeysRef.current.has(identity)) {
        keyOrderRef.current += 1;
        pressedKeysRef.current.set(identity, {
          label: formatActiveKeyLabel(event),
          order: keyOrderRef.current,
        });
      }
      if (event.repeat) {
        return;
      }
      showHeldKeyboardEntry();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const releasedKey = pressedKeysRef.current.get(getKeyIdentity(event));
      pressedKeysRef.current.delete(getKeyIdentity(event));
      if (pressedKeysRef.current.size > 0) {
        showHeldKeyboardEntry();
        return;
      }

      const entryId = keyboardEntryIdRef.current ?? undefined;
      keyboardEntryIdRef.current = null;
      if (releasedKey) {
        showEntry({ labels: [releasedKey.label] }, {
          durationMs: KEY_TAP_DISPLAY_DURATION_MS,
          entryId,
        });
        return;
      }

      if (entryId !== undefined) {
        startEntryExit(entryId);
      }
    };

    const showMouseGesture = (
      gesture: PendingMouseGesture,
      actionLabel?: string,
      options?: ShowEntryOptions,
    ) => {
      const heldKeysActive = pressedKeysRef.current.size > 0;
      let entryId: number | undefined = options?.entryId;
      let onHide = options?.onHide;
      if (heldKeysActive && entryId === undefined) {
        entryId = keyboardEntryIdRef.current ?? undefined;
        onHide = (currentEntryId) => restoreHeldKeyboardEntry(currentEntryId);
      }
      const labels = actionLabel
        ? uniqueLabels([...gesture.labels, actionLabel])
        : gesture.labels;
      const mousePressMode: MousePressMode = options?.mousePressMode
        ?? (gesture.isDragging ? 'held' : 'click');
      const shouldRestoreHeldKeys = heldKeysActive && mousePressMode !== 'held';
      const shouldAutoHide = mousePressMode !== 'held' || shouldRestoreHeldKeys;
      const hideAfterMs = shouldAutoHide
        ? options?.hideAfterMs ?? options?.durationMs ?? DEFAULT_DISPLAY_DURATION_MS
        : options?.hideAfterMs;
      const mouseAnimationId = mousePressMode === 'click'
        ? mouseAnimationIdRef.current + 1
        : mouseAnimationIdRef.current;
      mouseAnimationIdRef.current = Math.max(mouseAnimationIdRef.current, mouseAnimationId);

      const nextEntryId = showEntry({
        labels,
        mouseAnimationId,
        mouseButton: gesture.button,
        mousePressMode,
      }, {
        ...options,
        entryId,
        hideAfterMs,
        isHeld: options?.isHeld || heldKeysActive || gesture.entryId !== undefined,
        onHide,
      });
      gesture.entryId = nextEntryId;
      return nextEntryId;
    };

    const handleMouseDown = (event: MouseEvent) => {
      const button = mouseButtonFromEvent(event);
      if (!button) {
        return;
      }
      const gesture: PendingMouseGesture = {
        button,
        isDragging: false,
        labels: getPointerPrefixLabels(event),
        startX: event.clientX,
        startY: event.clientY,
      };
      pendingMouseGestureRef.current = gesture;
      showMouseGesture(gesture, undefined, {
        isHeld: true,
        mousePressMode: 'held',
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      const gesture = pendingMouseGestureRef.current;
      if (!gesture || gesture.isDragging) {
        return;
      }
      if (!hasDragged(gesture.startX, gesture.startY, event.clientX, event.clientY)) {
        return;
      }
      gesture.isDragging = true;
      showMouseGesture(gesture, mouseDragLabel(gesture.button), {
        entryId: gesture.entryId,
        isHeld: true,
        mousePressMode: 'held',
      });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const gesture = pendingMouseGestureRef.current;
      if (!gesture) {
        return;
      }
      const isDragging = gesture.isDragging
        || hasDragged(gesture.startX, gesture.startY, event.clientX, event.clientY);
      pendingMouseGestureRef.current = null;

      if (isDragging) {
        if (gesture.entryId && gesture.isDragging) {
          restoreHeldKeyboardEntry(gesture.entryId);
          return;
        }
        showMouseGesture(gesture, mouseDragLabel(gesture.button), {
          durationMs: QUICK_DRAG_DISPLAY_DURATION_MS,
          entryId: gesture.entryId,
          mousePressMode: 'click',
        });
        return;
      }

      showMouseGesture(gesture, undefined, {
        durationMs: MOUSE_RELEASE_DISPLAY_DURATION_MS,
        entryId: gesture.entryId,
        mousePressMode: 'click',
      });
    };

    const handleWheel = (event: WheelEvent) => {
      const direction = wheelDirectionFromEvent(event);
      if (!direction) {
        return;
      }

      const labels = getPointerComboLabels(event, wheelDirectionLabel(direction));
      const now = performance.now();
      const lastWheel = lastWheelRef.current;
      const heldKeysActive = pressedKeysRef.current.size > 0;
      const entryId = heldKeysActive
        ? keyboardEntryIdRef.current ?? undefined
        : lastWheel && now - lastWheel.time < WHEEL_CONTINUITY_MS
        ? lastWheel.entryId
        : undefined;

      const currentEntryId = showEntry({
        labels,
        wheelDirection: direction,
      }, {
        durationMs: WHEEL_DISPLAY_DURATION_MS,
        hideAfterMs: WHEEL_DISPLAY_DURATION_MS,
        entryId,
        isHeld: true,
        onHide: heldKeysActive
          ? (currentEntryId) => restoreHeldKeyboardEntry(currentEntryId)
          : undefined,
      });
      lastWheelRef.current = { entryId: currentEntryId, time: now };
    };

    const clearPressedKeys = () => {
      pressedKeysRef.current.clear();
      keyboardEntryIdRef.current = null;
      pendingMouseGestureRef.current = null;
      lastWheelRef.current = null;
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    window.addEventListener('blur', clearPressedKeys);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('blur', clearPressedKeys);
      clearPressedKeys();
    };
  }, [
    getPointerComboLabels,
    getPointerPrefixLabels,
    restoreHeldKeyboardEntry,
    showEntry,
    showHeldKeyboardEntry,
    showShortcutDisplay,
    startEntryExit,
  ]);

  if (!entry) {
    return null;
  }

  const style = {
    '--shortcut-display-scale': shortcutDisplayScale,
    '--shortcut-display-duration': `${entry.durationMs}ms`,
  } as CSSProperties;

  const showMouse = entry.mouseButton && canShowMouseGlyph(entry.mouseButton);
  const showPointerSeparator = entry.labels.length > 0 && (showMouse || entry.wheelDirection);
  const cardClassName = [
    'shortcut-display-card',
    entry.isHeld ? 'shortcut-display-card--held' : '',
    entry.isExiting ? 'shortcut-display-card--exiting' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="shortcut-display-overlay" style={style}>
      <div className={cardClassName} key={entry.id}>
        <span className="shortcut-display-keys">
          {entry.labels.map((label, index) => (
            <span
              className={`shortcut-display-key-part${index > 0 ? ' shortcut-display-key-part--joined' : ''}`}
              key={`${label}-${index}`}
            >
              {index > 0 && (
                <span className="shortcut-display-plus">+</span>
              )}
              <span className="shortcut-display-keycap">{label}</span>
            </span>
          ))}
        </span>
        {showPointerSeparator && <span className="shortcut-display-plus">+</span>}
        {showMouse && (
          <MouseGlyph
            activeButton={entry.mouseButton as 'left' | 'middle' | 'right'}
            animationId={entry.mouseAnimationId ?? 0}
            mode={entry.mousePressMode ?? 'click'}
          />
        )}
        {entry.wheelDirection && <WheelGlyph direction={entry.wheelDirection} />}
      </div>
    </div>
  );
}

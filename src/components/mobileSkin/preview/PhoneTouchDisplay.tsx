// Input display of the phone editor: while "Show touches" is on (the same setting as the desktop's
// "Show shortcuts and mouse clicks", sized by its Size slider) every finger on the screen gets a ring,
// for screen recordings and tutorials. It only listens (passive, capture) and never takes a touch:
// pointer-events none, so every control keeps working underneath.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useSettingsStore } from '../../../stores/settingsStore';
import { PHONE_TOUCH_DISPLAY_TEST_IDS, PHONE_TOUCH_DOT_SIZE } from './phoneTouchDisplayIds';

const LINGER_MS = 350;

interface Dot { id: number; x: number; y: number; down: boolean }

export function PhoneTouchDisplay() {
  const enabled = useSettingsStore((state) => state.showShortcutDisplay);
  const scale = useSettingsStore((state) => state.shortcutDisplayScale);
  const [dots, setDots] = useState<Dot[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timers = new Set<number>();
    const place = (event: PointerEvent, down: boolean) => setDots((current) => {
      const others = current.filter((dot) => dot.id !== event.pointerId);
      return [...others, { id: event.pointerId, x: event.clientX, y: event.clientY, down }];
    });
    const onDown = (event: PointerEvent) => place(event, true);
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.buttons === 0) return;
      place(event, true);
    };
    const onUp = (event: PointerEvent) => {
      place(event, false);
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        setDots((current) => current.filter((dot) => dot.id !== event.pointerId || dot.down));
      }, LINGER_MS);
      timers.add(timer);
    };
    const options = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', onDown, options);
    window.addEventListener('pointermove', onMove, options);
    window.addEventListener('pointerup', onUp, options);
    window.addEventListener('pointercancel', onUp, options);
    return () => {
      window.removeEventListener('pointerdown', onDown, options);
      window.removeEventListener('pointermove', onMove, options);
      window.removeEventListener('pointerup', onUp, options);
      window.removeEventListener('pointercancel', onUp, options);
      timers.forEach((timer) => window.clearTimeout(timer));
      setDots([]);
    };
  }, [enabled]);

  if (!enabled || typeof document === 'undefined') return null;
  const size = Math.round(PHONE_TOUCH_DOT_SIZE * scale);
  return createPortal(
    <div data-testid={PHONE_TOUCH_DISPLAY_TEST_IDS.root} aria-hidden="true"
      style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none', overflow: 'hidden' }}>
      {dots.map((dot) => (
        <span key={dot.id} data-testid={PHONE_TOUCH_DISPLAY_TEST_IDS.dot} data-size={size} data-down={dot.down ? 'true' : 'false'}
          style={{
            position: 'absolute', left: dot.x - size / 2, top: dot.y - size / 2, width: size, height: size, borderRadius: '50%',
            border: '3px solid rgba(255, 255, 255, 0.9)', background: 'rgba(79, 176, 255, 0.35)', boxSizing: 'border-box',
            opacity: dot.down ? 1 : 0.4, transition: 'opacity 0.3s',
          }} />
      ))}
    </div>,
    document.body,
  );
}

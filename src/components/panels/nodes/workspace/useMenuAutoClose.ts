import { useEffect, useRef } from 'react';

/** Grace period after the pointer leaves the menu before it closes on its own. */
const MENU_LEAVE_CLOSE_DELAY_MS = 700;
/** Grace period for a freshly opened menu the pointer never enters. */
const MENU_IDLE_CLOSE_DELAY_MS = 1500;

/**
 * Without the pointer over a menu (or any flyout, which are DOM children) it closes shortly:
 * right after opening if it is never entered, and after the pointer leaves unless it returns.
 * `keepOpen` (a typed search, a shown error) suppresses the leave close.
 */
export function useMenuAutoClose(onClose: () => void, keepOpen: boolean) {
  const timer = useRef<number | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    timer.current = window.setTimeout(() => onCloseRef.current(), MENU_IDLE_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, []);
  const cancel = () => window.clearTimeout(timer.current);
  return {
    cancel,
    onMouseEnter: cancel,
    onMouseLeave: () => {
      cancel();
      if (!keepOpen) timer.current = window.setTimeout(() => onCloseRef.current(), MENU_LEAVE_CLOSE_DELAY_MS);
    },
  };
}

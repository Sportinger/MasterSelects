// useShortcut — convenience hook for binding a single shortcut action
// For complex multi-action handlers, use getShortcutRegistry().matches() directly

import { useEffect } from 'react';
import { getShortcutRegistry } from '../services/shortcutRegistry';
import { claimShortcut } from '../services/shortcutFocusPolicy';
import type { ShortcutActionId } from '../services/shortcutTypes';

interface UseShortcutOptions {
  /** Use capture phase (default: false) */
  capture?: boolean;
  /** Conditionally enable (default: true) */
  enabled?: boolean;
  /** Fire even in text fields (default: false) */
  allowInInput?: boolean;
  /** Claim the shortcut only when this handler owns the current UI context. */
  shouldHandle?: (event: KeyboardEvent) => boolean;
}

export function useShortcut(
  action: ShortcutActionId,
  callback: (event: KeyboardEvent) => void,
  options: UseShortcutOptions = {},
): void {
  const {
    capture = false,
    enabled = true,
    allowInInput = false,
    shouldHandle,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    const registry = getShortcutRegistry();

    const handler = (e: KeyboardEvent) => {
      if (!registry.matches(action, e) || (shouldHandle && !shouldHandle(e))) return;
      if (!claimShortcut(e, action, { allowInTextEntry: allowInInput })) return;
      callback(e);
    };

    window.addEventListener('keydown', handler, capture);
    return () => window.removeEventListener('keydown', handler, capture);
  }, [action, callback, capture, enabled, allowInInput, shouldHandle]);
}

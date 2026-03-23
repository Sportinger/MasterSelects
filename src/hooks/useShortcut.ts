// useShortcut — convenience hook for binding a single shortcut action
// For complex multi-action handlers, use getShortcutRegistry().matches() directly

import { useEffect } from 'react';
import { getShortcutRegistry } from '../services/shortcutRegistry';
import type { ShortcutActionId } from '../services/shortcutTypes';

interface UseShortcutOptions {
  /** Use capture phase (default: false) */
  capture?: boolean;
  /** Conditionally enable (default: true) */
  enabled?: boolean;
  /** Fire even in text fields (default: false) */
  allowInInput?: boolean;
}

export function useShortcut(
  action: ShortcutActionId,
  callback: () => void,
  options: UseShortcutOptions = {},
): void {
  const { capture = false, enabled = true, allowInInput = false } = options;

  useEffect(() => {
    if (!enabled) return;

    const registry = getShortcutRegistry();

    const handler = (e: KeyboardEvent) => {
      if (!allowInInput) {
        const isTextInput =
          e.target instanceof HTMLTextAreaElement ||
          (e.target instanceof HTMLInputElement &&
            e.target.type !== 'range' &&
            e.target.type !== 'checkbox' &&
            e.target.type !== 'radio');
        if (isTextInput) return;
      }

      if (registry.matches(action, e)) {
        e.preventDefault();
        callback();
      }
    };

    window.addEventListener('keydown', handler, capture);
    return () => window.removeEventListener('keydown', handler, capture);
  }, [action, callback, capture, enabled, allowInInput]);
}

import { useEffect } from 'react';

import { handoffPointerFocus } from '../services/shortcutFocusPolicy';

export function usePointerFocusHandoff(): void {
  useEffect(() => {
    document.addEventListener('pointerdown', handoffPointerFocus, true);
    return () => document.removeEventListener('pointerdown', handoffPointerFocus, true);
  }, []);
}

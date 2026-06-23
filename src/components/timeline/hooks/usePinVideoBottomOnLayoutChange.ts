import { useEffect } from 'react';

import { DOCK_LAYOUT_TRANSITION_EVENT } from '../../../stores/dockStore';

export function usePinVideoBottomOnLayoutChange(setForceVideoBottomScroll: (value: boolean) => void): void {
  useEffect(() => {
    const pinVideoBottom = () => setForceVideoBottomScroll(true);
    pinVideoBottom();

    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT, pinVideoBottom);
    return () => window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT, pinVideoBottom);
  }, [setForceVideoBottomScroll]);
}

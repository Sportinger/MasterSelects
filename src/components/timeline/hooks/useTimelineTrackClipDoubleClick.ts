import { useCallback } from 'react';
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react';

import type { TimelineTrackProps } from '../types';

export function useTimelineTrackClipDoubleClick(input: {
  hitTestClipAtClientX: (clientX: number, rowEl: HTMLElement) => string | null;
  onClipDoubleClick: TimelineTrackProps['onClipDoubleClick'];
  setHoveredClipId: Dispatch<SetStateAction<string | null>>;
}) {
  return useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, [data-shell-trim-edge], [data-shell-fade-edge]')) return;
    const hit = input.hitTestClipAtClientX(event.clientX, event.currentTarget);
    if (!hit) return;
    input.setHoveredClipId(hit);
    input.onClipDoubleClick(event, hit);
  }, [input.hitTestClipAtClientX, input.onClipDoubleClick, input.setHoveredClipId]);
}

// Pick Whip Drag Hook - handles clip and track parenting via drag

import { useCallback } from 'react';

interface UsePickWhipDragProps {
  setClipParent: (clipId: string, parentClipId: string | null) => void;
  setTrackParent: (trackId: string, parentTrackId: string | null) => void;
}

export function usePickWhipDrag({ setClipParent, setTrackParent }: UsePickWhipDragProps) {
  // Pick whip disabled
  const noop = useCallback(() => {}, []);
  const noopDragStart = useCallback((_id: string, _startX: number, _startY: number) => {}, []);
  void setClipParent;
  void setTrackParent;

  return {
    pickWhipDrag: null,
    handlePickWhipDragStart: noopDragStart,
    handlePickWhipDragEnd: noop,
    trackPickWhipDrag: null,
    handleTrackPickWhipDragStart: noopDragStart,
    handleTrackPickWhipDragEnd: noop,
  };
}

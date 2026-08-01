/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react';
import type { MotionParentDropStatus } from './utils/motionParentingUi';

export interface TimelinePickWhipUiState {
  sourceClipId: string;
  targetClipId: string | null;
  status: MotionParentDropStatus;
  diagnostic: string;
}

export interface TimelinePickWhipContextValue {
  drag: TimelinePickWhipUiState | null;
  startDrag: (clipId: string, startX: number, startY: number) => void;
  cancelDrag: () => void;
  clearParent: (clipId: string) => void;
}

const TimelinePickWhipContext = createContext<TimelinePickWhipContextValue | null>(null);

export function TimelinePickWhipProvider({
  value,
  children,
}: {
  value: TimelinePickWhipContextValue;
  children: ReactNode;
}) {
  return (
    <TimelinePickWhipContext.Provider value={value}>
      {children}
    </TimelinePickWhipContext.Provider>
  );
}

export function useTimelinePickWhipContext(): TimelinePickWhipContextValue | null {
  return useContext(TimelinePickWhipContext);
}

interface TimelineMouseMoveScheduler<TEvent extends MouseEvent> {
  handleMouseMove: (moveEvent: TEvent) => void;
  flushPendingMouseMove: () => void;
  clear: () => void;
}

export function createTimelineMouseMoveScheduler<TEvent extends MouseEvent = MouseEvent>(
  processMouseMove: (moveEvent: TEvent) => void,
): TimelineMouseMoveScheduler<TEvent> {
  let pendingMoveEvent: TEvent | null = null;
  let moveAnimationFrameId: number | null = null;

  const cancelPendingMouseMoveFrame = () => {
    if (moveAnimationFrameId !== null) {
      window.cancelAnimationFrame(moveAnimationFrameId);
      moveAnimationFrameId = null;
    }
  };

  const flushPendingMouseMove = () => {
    cancelPendingMouseMoveFrame();
    const moveEvent = pendingMoveEvent;
    pendingMoveEvent = null;
    if (moveEvent) {
      processMouseMove(moveEvent);
    }
  };

  const handleMouseMove = (moveEvent: TEvent) => {
    pendingMoveEvent = moveEvent;
    if (moveAnimationFrameId !== null) return;

    moveAnimationFrameId = window.requestAnimationFrame(() => {
      moveAnimationFrameId = null;
      const latestMoveEvent = pendingMoveEvent;
      pendingMoveEvent = null;
      if (latestMoveEvent) {
        processMouseMove(latestMoveEvent);
      }
    });
  };

  return {
    handleMouseMove,
    flushPendingMouseMove,
    clear: () => {
      cancelPendingMouseMoveFrame();
      pendingMoveEvent = null;
    },
  };
}

export const createClipDragMouseMoveScheduler = createTimelineMouseMoveScheduler;

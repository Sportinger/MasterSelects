const DOUBLE_TOUCH_WINDOW_MS = 350;
const TAP_MOVE_SLOP_PX = 12;
const DOUBLE_TOUCH_DISTANCE_PX = 24;

interface DockTabTouchInput {
  button: number;
  clientX: number;
  clientY: number;
  isPrimary: boolean;
  panelId: string;
  pointerId: number;
  pointerType: string;
}

interface TouchStart {
  clientX: number;
  clientY: number;
  panelId: string;
  pointerId: number;
}

interface CompletedTap {
  clientX: number;
  clientY: number;
  panelId: string;
  time: number;
}

function distanceBetween(
  first: { clientX: number; clientY: number },
  second: { clientX: number; clientY: number },
): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

export class DockTabDoubleTouchTracker {
  private activeTouch: TouchStart | null = null;
  private lastTap: CompletedTap | null = null;

  pointerDown(input: DockTabTouchInput): void {
    if (input.pointerType !== 'touch' || input.button !== 0 || !input.isPrimary) return;
    this.activeTouch = {
      clientX: input.clientX,
      clientY: input.clientY,
      panelId: input.panelId,
      pointerId: input.pointerId,
    };
  }

  pointerUp(input: DockTabTouchInput, now = performance.now()): boolean {
    const touchStart = this.activeTouch;
    this.activeTouch = null;
    if (
      input.pointerType !== 'touch'
      || input.button !== 0
      || !input.isPrimary
    ) {
      return false;
    }
    if (
      !touchStart
      || touchStart.pointerId !== input.pointerId
      || touchStart.panelId !== input.panelId
      || distanceBetween(touchStart, input) > TAP_MOVE_SLOP_PX
    ) {
      this.lastTap = null;
      return false;
    }

    const previousTap = this.lastTap;
    const isDoubleTouch = previousTap !== null
      && previousTap.panelId === input.panelId
      && now - previousTap.time <= DOUBLE_TOUCH_WINDOW_MS
      && distanceBetween(previousTap, input) <= DOUBLE_TOUCH_DISTANCE_PX;

    this.lastTap = isDoubleTouch ? null : {
      clientX: input.clientX,
      clientY: input.clientY,
      panelId: input.panelId,
      time: now,
    };
    return isDoubleTouch;
  }

  cancel(pointerId?: number): void {
    if (pointerId !== undefined && this.activeTouch?.pointerId !== pointerId) return;
    this.activeTouch = null;
    this.lastTap = null;
  }
}

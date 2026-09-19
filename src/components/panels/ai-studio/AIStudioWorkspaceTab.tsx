import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface AIStudioWorkspaceTabProps {
  active: boolean;
  dimmed: boolean;
  label: string;
  pulsing: boolean;
  running: boolean;
  workspaceId: string;
  onActivate: (workspaceId: string) => void;
  onOpenMenu: (workspaceId: string, clientX: number, clientY: number) => void;
}

const LONG_PRESS_MS = 560;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export function AIStudioWorkspaceTab({
  active,
  dimmed,
  label,
  pulsing,
  running,
  workspaceId,
  onActivate,
  onOpenMenu,
}: AIStudioWorkspaceTabProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const consumedClickRef = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerOriginRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'touch') return;
    cancelLongPress();
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      consumedClickRef.current = true;
      longPressTimerRef.current = null;
      onOpenMenu(workspaceId, event.clientX, event.clientY);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = pointerOriginRef.current;
    if (!origin) return;
    if (
      Math.abs(event.clientX - origin.x) > LONG_PRESS_MOVE_TOLERANCE_PX
      || Math.abs(event.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    ) {
      cancelLongPress();
    }
  };

  return (
    <button
      aria-busy={running || undefined}
      className={[
        'ai-studio-subtab',
        active ? 'active' : '',
        dimmed ? 'is-run-dimmed' : '',
        running ? 'is-running' : '',
        pulsing ? 'is-pulsing' : '',
      ].filter(Boolean).join(' ')}
      data-workspace-id={workspaceId}
      onClick={(event) => {
        if (consumedClickRef.current) {
          consumedClickRef.current = false;
          event.preventDefault();
          return;
        }
        onActivate(workspaceId);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(workspaceId, event.clientX, event.clientY);
      }}
      onPointerCancel={cancelLongPress}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      type="button"
    >
      {label}
    </button>
  );
}

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { TimelineToolGroupId } from '../../../stores/timeline/types';
import type { TimelineToolIcon } from './toolIcons';

interface TimelineToolButtonProps {
  groupId: TimelineToolGroupId;
  label: string;
  title: string;
  active: boolean;
  icon: TimelineToolIcon;
  onActivate: (groupId: TimelineToolGroupId) => void;
  onOpen: (groupId: TimelineToolGroupId, anchor: HTMLButtonElement) => void;
}

const HOLD_TO_OPEN_MS = 350;
const CHEVRON_HIT_WIDTH = 8;
const ROOT_TOOL_ICON_SIZE = 18;

export function TimelineToolButton({
  groupId,
  label,
  title,
  active,
  icon: Icon,
  onActivate,
  onOpen,
}: TimelineToolButtonProps) {
  const holdTimerRef = useRef<number | null>(null);
  const openedByHoldRef = useRef(false);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const openFlyout = (button: HTMLButtonElement) => {
    openedByHoldRef.current = true;
    clearHoldTimer();
    onOpen(groupId, button);
  };

  const isChevronPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX >= rect.right - CHEVRON_HIT_WIDTH;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    openedByHoldRef.current = false;

    if (isChevronPointer(event)) {
      event.preventDefault();
      openFlyout(event.currentTarget);
      return;
    }

    holdTimerRef.current = window.setTimeout(() => {
      openFlyout(event.currentTarget);
    }, HOLD_TO_OPEN_MS);
  };

  const handlePointerUp = () => {
    clearHoldTimer();
    if (openedByHoldRef.current) {
      openedByHoldRef.current = false;
      return;
    }
    onActivate(groupId);
  };

  const handlePointerCancel = () => {
    clearHoldTimer();
    openedByHoldRef.current = false;
  };

  return (
    <button
      type="button"
      className={`timeline-tool-button ${active ? 'active' : ''}`}
      data-tool-group={groupId}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={active}
      title={title}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={clearHoldTimer}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => {
        event.preventDefault();
        openFlyout(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openFlyout(event.currentTarget);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate(groupId);
        }
      }}
    >
      <Icon className="timeline-tool-button-icon" size={ROOT_TOOL_ICON_SIZE} stroke={2.2} aria-hidden="true" />
      <span className="timeline-tool-button-chevron" aria-hidden="true" />
    </button>
  );
}

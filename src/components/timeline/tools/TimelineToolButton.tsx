import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { TimelineToolGroupId } from '../../../stores/timeline/types';
import type { TimelineToolIcon } from './toolIcons';

interface TimelineToolButtonProps {
  groupId: TimelineToolGroupId;
  label: string;
  title: string;
  active: boolean;
  open: boolean;
  icon: TimelineToolIcon;
  onActivate: (groupId: TimelineToolGroupId) => void;
  onOpen: (groupId: TimelineToolGroupId, anchor: HTMLButtonElement, options?: { armPressDrag?: boolean }) => void;
  onRegister?: (groupId: TimelineToolGroupId, button: HTMLButtonElement | null) => void;
}

const HOLD_TO_OPEN_MS = 200;
const ROOT_TOOL_ICON_SIZE = 18;

export function TimelineToolButton({
  groupId,
  label,
  title,
  active,
  open,
  icon: Icon,
  onActivate,
  onOpen,
  onRegister,
}: TimelineToolButtonProps) {
  const holdTimerRef = useRef<number | null>(null);
  const releaseListenerRef = useRef<((event: PointerEvent) => void) | null>(null);
  const openedRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    onRegister?.(groupId, buttonRef.current);
    return () => onRegister?.(groupId, null);
  }, [groupId, onRegister]);

  // Cancels a pending hold and removes the window-level release watcher.
  const clearHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (releaseListenerRef.current) {
      window.removeEventListener('pointerup', releaseListenerRef.current, true);
      releaseListenerRef.current = null;
    }
  };

  useEffect(() => clearHold, []);

  // Opens the flyout at most once per press. `armPressDrag` tells the flyout the
  // pointer is still down so it can resolve the selection on release.
  const openFlyout = (button: HTMLButtonElement, options?: { armPressDrag?: boolean }) => {
    if (openedRef.current) return;
    openedRef.current = true;
    clearHold();
    onOpen(groupId, button, options);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    openedRef.current = false;
    clearHold();

    // Watch for the release on the window too, so a quick click that lifts off
    // the (tiny) button never leaves a pending hold that opens the flyout late.
    const onRelease = () => clearHold();
    releaseListenerRef.current = onRelease;
    window.addEventListener('pointerup', onRelease, true);

    // Holding anywhere on the button past the threshold opens the grouped-tool
    // flyout while the pointer is still pressed (press-drag-release).
    const anchor = event.currentTarget;
    holdTimerRef.current = window.setTimeout(() => {
      openFlyout(anchor, { armPressDrag: true });
    }, HOLD_TO_OPEN_MS);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    clearHold();
    openedRef.current = false;
    // Released over the button itself — either a quick click, or a hold released
    // without sliding onto a flyout item. Either way activate the current tool
    // so a press never swallows the click. Releases over a flyout item (select)
    // or empty space (cancel) happen off the button and are handled by the flyout.
    onActivate(groupId);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`timeline-tool-button ${active ? 'active' : ''} ${open ? 'open' : ''}`}
      data-tool-group={groupId}
      data-guided-button={`timeline-tool-group:${groupId}`}
      data-guided-target={`button:timeline-tool-group:${groupId}`}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      title={title}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        openedRef.current = false;
        clearHold();
        openFlyout(event.currentTarget, { armPressDrag: false });
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openedRef.current = false;
          clearHold();
          openFlyout(event.currentTarget, { armPressDrag: false });
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate(groupId);
        }
      }}
    >
      <Icon className="timeline-tool-button-icon" size={ROOT_TOOL_ICON_SIZE} stroke={2.2} aria-hidden="true" />
      {/* Non-interactive hint that the button hides a grouped-tool flyout. */}
      <span className="timeline-tool-button-chevron" aria-hidden="true" />
    </button>
  );
}

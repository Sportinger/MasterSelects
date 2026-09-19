import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { useDockStore } from '../../../stores/dockStore';
import { isMobileLayoutId } from '../../dock/mobileLayoutOrientation';

const SWIPE_CONFIRM_THRESHOLD = 0.82;
const SWIPE_THUMB_SIZE_PX = 30;
const SWIPE_TRACK_GUTTER_PX = 3;

type SwipeStyle = CSSProperties & {
  '--export-swipe-offset': string;
  '--export-swipe-progress': string;
};

interface ExportActionFooterProps {
  disabled: boolean;
  estimatedSizeLabel: string;
  label: string;
  onExport: () => void;
}

export function ExportActionFooter({
  disabled,
  estimatedSizeLabel,
  label,
  onExport,
}: ExportActionFooterProps) {
  const activeLayoutId = useDockStore(state => state.activeSavedLayoutId);
  const mobileLayoutActive = isMobileLayoutId(activeLayoutId);
  const activePointerIdRef = useRef<number | null>(null);
  const [swipeState, setSwipeState] = useState({ dragging: false, offset: 0, progress: 0 });
  const estimatedSizeVisible = estimatedSizeLabel.startsWith('~');

  const updateSwipePosition = (track: HTMLButtonElement, clientX: number): number => {
    const rect = track.getBoundingClientRect();
    const maxOffset = Math.max(0, rect.width - SWIPE_THUMB_SIZE_PX - SWIPE_TRACK_GUTTER_PX * 2);
    const offset = Math.max(
      0,
      Math.min(maxOffset, clientX - rect.left - SWIPE_TRACK_GUTTER_PX - SWIPE_THUMB_SIZE_PX / 2),
    );
    const progress = maxOffset > 0 ? offset / maxOffset : 0;
    setSwipeState(current => ({ ...current, offset, progress }));
    return progress;
  };

  const finishSwipe = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    const progress = cancelled ? 0 : updateSwipePosition(event.currentTarget, event.clientX);
    activePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSwipeState({ dragging: false, offset: 0, progress: 0 });
    event.currentTarget.blur();
    if (!cancelled && progress >= SWIPE_CONFIRM_THRESHOLD && !disabled) onExport();
  };

  if (mobileLayoutActive) {
    const swipeStyle: SwipeStyle = {
      '--export-swipe-offset': `${swipeState.offset}px`,
      '--export-swipe-progress': `${Math.round(swipeState.progress * 100)}%`,
    };
    return (
      <footer className="export-action-footer is-mobile-swipe">
        <button
          aria-label={`Swipe to ${label}`}
          className={`export-swipe-submit${swipeState.dragging ? ' is-dragging' : ''}`}
          data-dock-tab-swipe-ignore="true"
          disabled={disabled}
          onClick={event => {
            event.preventDefault();
            if (event.detail === 0 && !disabled) onExport();
          }}
          onContextMenu={event => event.preventDefault()}
          onPointerCancel={event => finishSwipe(event, true)}
          onPointerDown={event => {
            if (
              disabled
              || event.button !== 0
              || !(event.target instanceof Element)
              || !event.target.closest('.export-swipe-thumb')
            ) return;
            event.preventDefault();
            activePointerIdRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            setSwipeState(current => ({ ...current, dragging: true }));
            updateSwipePosition(event.currentTarget, event.clientX);
          }}
          onPointerMove={event => {
            if (activePointerIdRef.current !== event.pointerId) return;
            event.preventDefault();
            updateSwipePosition(event.currentTarget, event.clientX);
          }}
          onPointerUp={event => finishSwipe(event, false)}
          style={swipeStyle}
          title={`Swipe to ${label}${estimatedSizeVisible ? ` ${estimatedSizeLabel}` : ''}`}
          type="button"
        >
          <span className="export-swipe-fill" aria-hidden="true" />
          <span className="export-swipe-copy" aria-hidden="true">
            <span>Swipe to {label}</span>
            {estimatedSizeVisible && <small>{estimatedSizeLabel}</small>}
          </span>
          <span className="export-swipe-thumb" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path d="m6 3 5 5-5 5" />
            </svg>
          </span>
        </button>
      </footer>
    );
  }

  return (
    <footer className="export-action-footer">
      <button
        aria-label={label}
        className="export-quick-submit export-summary-cta"
        disabled={disabled}
        onClick={onExport}
        title={`${label}${estimatedSizeVisible ? ` ${estimatedSizeLabel}` : ''}`}
        type="button"
      >
        <span>{label}</span>
        {estimatedSizeVisible && (
          <small className="export-summary-cta-size">{estimatedSizeLabel}</small>
        )}
      </button>
    </footer>
  );
}

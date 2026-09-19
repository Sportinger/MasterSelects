import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';

type ReconnectState = 'idle' | 'reconnecting' | 'restored' | 'unavailable';

interface MediaReconnectButtonProps {
  mediaFileId: string;
  variant?: 'inline' | 'overlay';
}

const RESET_DELAY_MS = 2200;

export function MediaReconnectButton({
  mediaFileId,
  variant = 'inline',
}: MediaReconnectButtonProps) {
  const reloadFile = useMediaStore((store) => store.reloadFile);
  const [state, setState] = useState<ReconnectState>('idle');
  const resetTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const stopPointerPropagation = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const stopMousePropagation = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const resetLater = () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setState('idle');
      resetTimerRef.current = null;
    }, RESET_DELAY_MS);
  };

  const handleReconnect = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (state === 'reconnecting') return;

    setState('reconnecting');
    try {
      const restored = await reloadFile(mediaFileId);
      if (!mountedRef.current) return;
      setState(restored ? 'restored' : 'unavailable');
    } catch {
      if (!mountedRef.current) return;
      setState('unavailable');
    }
    resetLater();
  };

  const label = state === 'reconnecting'
    ? 'Reconnecting…'
    : state === 'restored'
      ? 'Reconnected'
      : state === 'unavailable'
        ? 'Unavailable'
        : 'Reconnect';
  const title = state === 'unavailable'
    ? 'Saved file access is unavailable. Use Relink in the Media panel to locate the file.'
    : 'Reconnect using saved file access (no file picker)';

  return (
    <button
      type="button"
      className={`media-reconnect-button ${variant === 'overlay' ? 'overlay' : 'inline'} ${state}`}
      aria-label={`${label} media file`}
      title={title}
      disabled={state === 'reconnecting'}
      onClick={handleReconnect}
      onPointerDown={stopPointerPropagation}
      onMouseDown={stopMousePropagation}
      onDoubleClick={stopMousePropagation}
    >
      <svg className="media-reconnect-button-icon" viewBox="0 0 16 16" aria-hidden="true">
        {state === 'restored' ? (
          <path d="M3 8.4 6.2 11.5 13 4.5" />
        ) : (
          <>
            <path d="M12.8 7A5 5 0 0 0 4 4.2" />
            <path d="M3.2 4.2H7V8" />
            <path d="M3.2 9A5 5 0 0 0 12 11.8" />
            <path d="M12.8 11.8H9V8" />
          </>
        )}
      </svg>
      <span className="media-reconnect-button-label">{label}</span>
    </button>
  );
}

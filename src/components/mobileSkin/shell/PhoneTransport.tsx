import { useEffect, useState } from 'react';
import { PHONE_TEST_IDS } from '../contracts';
import { Logger } from '../../../services/logger';
import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneRuntime } from '../runtime/PhoneRuntimeContext';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneKeyframeButton } from '../keyframe/PhoneKeyframeButton';
import { runPhoneHistoryTap, usePhoneHistoryBlockReason } from '../sheets/phoneHistoryGuard';
import { PHONE_PREVIEW_TEST_IDS, usePhonePreviewModeStore } from '../preview/phonePreviewMode';
import { PhoneIcon } from './phoneIcons';

const log = Logger.create('PhoneTransport');

/** mm:ss.ff at the composition frame rate. */
export function formatPhoneTime(seconds: number, frameRate: number): string {
  const fps = Math.max(1, Math.round(frameRate) || 30);
  const totalFrames = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}.${pad(frames, fps >= 100 ? 3 : 2)}`;
}

function useLivePlayhead(isPlaying: boolean): number {
  const stored = useTimelineStore((state) => state.playheadPosition);
  const [live, setLive] = useState(stored);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let frame = 0;
    const tick = () => {
      setLive(getPlayheadPosition(useTimelineStore.getState().playheadPosition));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying]);

  // While paused the store value is authoritative; while playing the rAF-sampled one is.
  return isPlaying ? live : stored;
}

/** Edited content end (the timeline duration is padded to a minimum workspace length). */
function selectContentEnd(state: { clips: readonly { startTime: number; duration: number }[] }): number {
  let end = 0;
  for (const clip of state.clips) end = Math.max(end, clip.startTime + clip.duration);
  return end;
}

/**
 * The running time. Its own component on purpose: while playing it re-renders every animation
 * frame, and nothing else in the transport (play, undo, redo, keyframe) must re-render with it.
 */
function PhoneTransportTime() {
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const contentEnd = useTimelineStore(selectContentEnd);
  const timelineDuration = useTimelineStore((state) => state.duration);
  const frameRate = useMediaStore(
    (state) => state.compositions.find((comp) => comp.id === state.activeCompositionId)?.frameRate ?? 30,
  );
  const position = useLivePlayhead(isPlaying);
  const duration = contentEnd > 0 ? contentEnd : timelineDuration;
  return (
    <div className="phone-transport__time" data-testid={PHONE_TEST_IDS.time}>
      <span className="phone-transport__now">{formatPhoneTime(position, frameRate)}</span>
      <span className="phone-transport__total"> / {formatPhoneTime(duration, frameRate)}</span>
    </div>
  );
}

export function PhoneTransport() {
  const { history } = usePhoneRuntime();
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const showToast = usePhoneUiStore((state) => state.showToast);
  // While an edit sheet holds its own changes, Undo/Redo wait for its Done or Cancel (phoneHistoryGuard).
  const undoBlocked = usePhoneHistoryBlockReason('undo');
  const redoBlocked = usePhoneHistoryBlockReason('redo');

  const togglePlay = async () => {
    const timeline = useTimelineStore.getState();
    try {
      if (timeline.isPlaying) timeline.pause();
      else await timeline.play();
    } catch (error) {
      log.error('Playback toggle failed', error);
      showToast(`Playback failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <div className="phone-transport" role="group" aria-label="Playback" data-testid={PHONE_TEST_IDS.transport}>
      <PhoneTransportTime />
      <button
        type="button"
        className="phone-icon-button phone-icon-button--play"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        data-testid={PHONE_TEST_IDS.play}
        data-playing={isPlaying ? 'true' : 'false'}
        onClick={() => void togglePlay()}
      >
        <PhoneIcon name={isPlaying ? 'pause' : 'play'} size={26} />
      </button>
      <div className="phone-transport__tools">
        <PhoneKeyframeButton />
        <button
          type="button"
          className="phone-icon-button"
          aria-label="Undo"
          aria-disabled={!history.canUndo || undoBlocked !== null}
          data-blocked={undoBlocked !== null ? 'true' : undefined}
          title={undoBlocked ?? undefined}
          data-testid={PHONE_TEST_IDS.undo}
          onClick={() => runPhoneHistoryTap('undo', history)}
        >
          <PhoneIcon name="undo" size={22} />
        </button>
        <button
          type="button"
          className="phone-icon-button"
          aria-label="Redo"
          aria-disabled={!history.canRedo || redoBlocked !== null}
          data-blocked={redoBlocked !== null ? 'true' : undefined}
          title={redoBlocked ?? undefined}
          data-testid={PHONE_TEST_IDS.redo}
          onClick={() => runPhoneHistoryTap('redo', history)}
        >
          <PhoneIcon name="redo" size={22} />
        </button>
        <button
          type="button"
          className="phone-icon-button"
          aria-label="Fullscreen preview"
          data-testid={PHONE_PREVIEW_TEST_IDS.fullscreenButton}
          onPointerUp={(event) => event.currentTarget.blur()}
          onClick={() => usePhonePreviewModeStore.getState().enterFullscreen()}
        >
          <PhoneIcon name="fullscreen" size={22} />
        </button>
      </div>
    </div>
  );
}

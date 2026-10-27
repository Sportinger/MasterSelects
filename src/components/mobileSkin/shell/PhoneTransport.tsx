import { useEffect, useMemo, useState } from 'react';
import { PHONE_FULL_EDITOR_HINT, PHONE_TEST_IDS } from '../contracts';
import { Logger } from '../../../services/logger';
import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneRuntime } from '../runtime/PhoneRuntimeContext';
import { usePhoneUiStore } from '../state/phoneUiStore';
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

interface GreyedProps {
  actionId: string;
  label: string;
  reason: string;
  icon: 'keyframe' | 'fullscreen';
}

function GreyedTransportButton({ actionId, label, reason, icon }: GreyedProps) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  return (
    <button
      type="button"
      className="phone-icon-button"
      aria-label={label}
      aria-disabled="true"
      data-testid={`phone-transport-${actionId}`}
      onClick={() => showUnavailable({ actionId, label, reason })}
    >
      <PhoneIcon name={icon} size={22} />
    </button>
  );
}

export function PhoneTransport() {
  const { history } = usePhoneRuntime();
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const clips = useTimelineStore((state) => state.clips);
  const timelineDuration = useTimelineStore((state) => state.duration);
  const frameRate = useMediaStore(
    (state) => state.compositions.find((comp) => comp.id === state.activeCompositionId)?.frameRate ?? 30,
  );
  const showToast = usePhoneUiStore((state) => state.showToast);
  const position = useLivePlayhead(isPlaying);

  // The timeline duration is padded to a minimum workspace length; show the edited content end.
  const contentEnd = useMemo(
    () => clips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0),
    [clips],
  );
  const duration = contentEnd > 0 ? contentEnd : timelineDuration;

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
    <div className="phone-transport" data-testid={PHONE_TEST_IDS.transport}>
      <div className="phone-transport__time" data-testid={PHONE_TEST_IDS.time}>
        <span className="phone-transport__now">{formatPhoneTime(position, frameRate)}</span>
        <span className="phone-transport__total"> / {formatPhoneTime(duration, frameRate)}</span>
      </div>
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
        <GreyedTransportButton
          actionId="keyframe"
          label="Add keyframe"
          icon="keyframe"
          reason={`Keyframes arrive with milestone M2 of the phone editor. ${PHONE_FULL_EDITOR_HINT}`}
        />
        <button
          type="button"
          className="phone-icon-button"
          aria-label="Undo"
          aria-disabled={!history.canUndo}
          data-testid={PHONE_TEST_IDS.undo}
          onClick={() => {
            if (history.canUndo) history.undo();
          }}
        >
          <PhoneIcon name="undo" size={22} />
        </button>
        <button
          type="button"
          className="phone-icon-button"
          aria-label="Redo"
          aria-disabled={!history.canRedo}
          data-testid={PHONE_TEST_IDS.redo}
          onClick={() => {
            if (history.canRedo) history.redo();
          }}
        >
          <PhoneIcon name="redo" size={22} />
        </button>
        <GreyedTransportButton
          actionId="fullscreen"
          label="Fullscreen preview"
          icon="fullscreen"
          reason={`Fullscreen preview arrives with milestone M3 of the phone editor. ${PHONE_FULL_EDITOR_HINT}`}
        />
      </div>
    </div>
  );
}

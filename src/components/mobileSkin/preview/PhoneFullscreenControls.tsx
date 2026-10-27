// Controls over the fullscreen preview: a tap anywhere on the picture leaves, the play button and
// the close button do their own thing. Time readout at the bottom.

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { Logger } from '../../../services/logger';
import { PhoneIcon } from '../shell/phoneIcons';
import { formatPhoneTime } from '../shell/PhoneTransport';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PHONE_PREVIEW_TEST_IDS as IDS, usePhonePreviewModeStore } from './phonePreviewMode';

const log = Logger.create('PhoneFullscreenControls');

export function PhoneFullscreenControls() {
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const frameRate = useMediaStore((state) => state.compositions.find((comp) => comp.id === state.activeCompositionId)?.frameRate ?? 30);
  const exit = () => usePhonePreviewModeStore.getState().exitFullscreen();

  const togglePlay = async () => {
    const timeline = useTimelineStore.getState();
    try {
      if (timeline.isPlaying) timeline.pause();
      else await timeline.play();
    } catch (error) {
      log.error('Playback toggle failed', error);
      usePhoneUiStore.getState().showToast(`Playback failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <div className="phone-fullscreen" onClick={exit} role="presentation">
      <button
        type="button"
        className="phone-fullscreen__button phone-fullscreen__exit"
        aria-label="Exit fullscreen"
        data-testid={IDS.fullscreenExit}
        onPointerUp={(event) => event.currentTarget.blur()}
        onClick={(event) => { event.stopPropagation(); exit(); }}
      >
        <PhoneIcon name="close" size={24} />
      </button>
      <div className="phone-fullscreen__bar" onClick={(event) => event.stopPropagation()} role="presentation">
        <button
          type="button"
          className="phone-fullscreen__button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-testid={IDS.fullscreenPlay}
          data-playing={isPlaying ? 'true' : 'false'}
          onPointerUp={(event) => event.currentTarget.blur()}
          onClick={() => { void togglePlay(); }}
        >
          <PhoneIcon name={isPlaying ? 'pause' : 'play'} size={26} />
        </button>
        <span className="phone-fullscreen__time" data-testid={IDS.fullscreenTime}>
          {isPlaying ? 'Playing' : formatPhoneTime(playhead, frameRate)}
        </span>
        <span className="phone-fullscreen__hint">Tap the picture to go back</span>
      </div>
    </div>
  );
}

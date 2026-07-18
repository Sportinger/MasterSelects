import { ExportImageControls } from './ExportImageControls';
import { ExportVideoControls } from './ExportVideoControls';
import type {
  ExportBasicsActions,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsImageState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

interface ExportVisualChannelCardProps {
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  image: ExportBasicsImageState;
  gif: ExportBasicsGifState;
  options: ExportBasicsOptionState;
  time: ExportBasicsTimeState;
  useInOut: boolean;
  actions: ExportBasicsActions;
}

export function ExportVisualChannelCard({
  mode,
  display,
  video,
  image,
  gif,
  options,
  time,
  useInOut,
  actions,
}: ExportVisualChannelCardProps) {
  return (
    <div className={`export-channel-card${!mode.isXmlMode && mode.videoEnabled ? '' : ' is-disabled'}`} data-export-target={mode.isImageMode ? 'image-section' : 'video-section'}>
      <div className="export-channel-head">
        <div className="export-channel-title">
          <span>{mode.isXmlMode ? 'XML' : mode.isImageMode ? 'Image' : 'Video'}</span>
          {mode.isXmlMode && <strong>Timeline interchange</strong>}
        </div>
        {mode.isXmlMode ? (
          <span className="export-chip export-chip-static">FCPXML</span>
        ) : (
          <button
            type="button"
            className={`export-toggle${mode.videoEnabled ? ' is-active' : ''}`}
            onClick={() => {
              if (mode.videoEnabled) {
                actions.setVideoEnabled(false);
                return;
              }
              actions.setSpecialContainer('none');
              actions.setVideoEnabled(true);
              actions.setVisualMode('video');
            }}
          >
            {mode.videoEnabled ? 'On' : 'Off'}
          </button>
        )}
      </div>

      {mode.isXmlMode ? (
        <div className="export-inline-note">
          XML export uses the current timeline structure and clip references. Render-specific video settings do not apply here.
        </div>
      ) : mode.isImageMode ? (
        <ExportImageControls
          image={image}
          video={video}
          options={options}
          time={time}
          actions={actions}
          isImageSequenceMode={mode.isImageSequenceMode}
          imageSequenceOutputLabel={mode.imageSequenceOutputLabel}
          useInOut={useInOut}
        />
      ) : mode.videoEnabled ? (
        <ExportVideoControls
          mode={mode}
          display={display}
          video={video}
          gif={gif}
          options={options}
          useInOut={useInOut}
          actions={actions}
        />
      ) : (
        <div className="export-inline-note">
          Visual export is disabled. Switch to Video or Image, or use Audio-only export.
        </div>
      )}
    </div>
  );
}

import type { ContainerFormat } from '../../../engine/export';
import type { FFmpegContainer } from '../../../engine/ffmpeg';
import type { BatchExportMediaType } from '../../../stores/exportStore';
import { IMAGE_FORMATS } from '../exportSettingsState';
import { ExportAudioChannelCard } from './ExportAudioChannelCard';
import { ExportVisualChannelCard } from './ExportVisualChannelCard';
import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsImageState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

interface ExportBasicsSectionProps {
  filename: string;
  filenameLocked?: boolean;
  sourceMediaType?: BatchExportMediaType;
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  image: ExportBasicsImageState;
  gif: ExportBasicsGifState;
  audio: ExportBasicsAudioState;
  options: ExportBasicsOptionState;
  time: ExportBasicsTimeState;
  useInOut: boolean;
  actions: ExportBasicsActions;
}

export function ExportBasicsSection({
  filename,
  filenameLocked = false,
  sourceMediaType,
  mode,
  display,
  video,
  image,
  gif,
  audio,
  options,
  time,
  useInOut,
  actions,
}: ExportBasicsSectionProps) {
  return (
    <div className="export-section export-basics-section">
      <div className="export-section-header">Basics</div>

      <div className="export-channel-grid">
        <div className="export-channel-card export-basic-card">
          <div className="export-channel-head">
            <div className="export-channel-title">
              <span>Basic</span>
              <strong>{display.displayContainerLabel}</strong>
            </div>
          </div>

          <div className="export-field-card export-subcard" data-export-target="basic-output">
            <div className="export-field-head">
              <span>Output</span>
              <strong>{display.displayOutputName}</strong>
            </div>
            <div className="control-row">
              <label htmlFor="export-output-name">Name</label>
              <div className="export-input-group">
                <input
                  id="export-output-name"
                  type="text"
                  value={filename}
                  onChange={(e) => actions.setFilename(e.target.value)}
                  placeholder="export"
                  disabled={filenameLocked}
                  title={filenameLocked ? 'File names stay individual while shared batch settings are active' : undefined}
                />
              </div>
            </div>
          </div>

          <div className="export-field-card export-subcard" data-export-target="basic-container">
            <div className="export-field-head">
              <span>Container</span>
              <strong>{display.displayContainerLabel}</strong>
            </div>
            <div className="export-container-groups">
              {(!sourceMediaType || sourceMediaType === 'video') && <div className="export-container-group">
                <span className="export-container-group-label">Video</span>
                <div className="export-chip-row">
                  {options.videoContainerFormats.map((format) => (
                    <button
                      key={`video-${format.id}`}
                      type="button"
                      className={`export-chip${!mode.isXmlMode && mode.isVideoMode && display.currentContainerId === format.id ? ' is-active' : ''}`}
                      onClick={() => {
                        actions.setSpecialContainer('none');
                        actions.setVideoEnabled(true);
                        if (format.id === 'gif') {
                          actions.setVisualMode('gif');
                          actions.setIncludeAudio(false);
                          if (mode.encoder === 'ffmpeg') {
                            actions.handleFFmpegContainerChange('gif');
                          }
                          return;
                        }
                        actions.setVisualMode('video');
                        if (mode.isWebCodecsEncoder) {
                          actions.setContainerFormat(format.id as ContainerFormat);
                        } else {
                          actions.handleFFmpegContainerChange(format.id as FFmpegContainer);
                        }
                      }}
                    >
                      .{format.id}
                    </button>
                  ))}
                </div>
              </div>}

              {(!sourceMediaType || sourceMediaType === 'image') && <div className="export-container-group">
                <span className="export-container-group-label">Image</span>
                <div className="export-chip-row">
                  {IMAGE_FORMATS.map((format) => (
                    <button
                      key={`image-${format.id}`}
                      type="button"
                      className={`export-chip${!mode.isXmlMode && mode.isImageMode && image.imageFormat === format.id ? ' is-active' : ''}`}
                      onClick={() => {
                        actions.setSpecialContainer('none');
                        actions.setVideoEnabled(true);
                        actions.setVisualMode('image');
                        actions.setImageFormat(format.id);
                      }}
                    >
                      .{format.id}
                    </button>
                  ))}
                </div>
              </div>}

              {(!sourceMediaType || sourceMediaType === 'audio') && <div className="export-container-group">
                <span className="export-container-group-label">Audio</span>
                <div className="export-chip-row">
                  <button
                    type="button"
                    className={`export-chip${!mode.isXmlMode && mode.isAudioOnlyMode && audio.audioOnlyFormat === 'wav' ? ' is-active' : ''}`}
                    onClick={() => {
                      actions.setSpecialContainer('none');
                      actions.setVisualMode('video');
                      actions.setVideoEnabled(false);
                      actions.setIncludeAudio(true);
                      actions.setAudioOnlyFormat('wav');
                    }}
                  >
                    .wav
                  </button>
                  <button
                    type="button"
                    className={`export-chip${!mode.isXmlMode && mode.isAudioOnlyMode && audio.audioOnlyFormat === 'mp3' ? ' is-active' : ''}`}
                    onClick={() => {
                      actions.setSpecialContainer('none');
                      actions.setVisualMode('video');
                      actions.setVideoEnabled(false);
                      actions.setIncludeAudio(true);
                      actions.setAudioOnlyFormat('mp3');
                    }}
                  >
                    .mp3
                  </button>
                  <button
                    type="button"
                    className={`export-chip${!mode.isXmlMode && mode.isAudioOnlyMode && audio.audioOnlyFormat === 'browser' ? ' is-active' : ''}`}
                    onClick={() => {
                      actions.setSpecialContainer('none');
                      actions.setVisualMode('video');
                      actions.setVideoEnabled(false);
                      actions.setIncludeAudio(true);
                      actions.setAudioOnlyFormat('browser');
                    }}
                    disabled={!mode.isAudioSupported}
                  >
                    .{display.browserAudioExtension}
                  </button>
                </div>
              </div>}

              {!sourceMediaType && <div className="export-container-group">
                <span className="export-container-group-label">XML</span>
                <div className="export-chip-row">
                  <button
                    type="button"
                    className={`export-chip${mode.isXmlMode ? ' is-active' : ''}`}
                    onClick={() => {
                      actions.setSpecialContainer('xml');
                      actions.setVideoEnabled(true);
                    }}
                  >
                    .fcpxml
                  </button>
                </div>
              </div>}
            </div>
          </div>

          {sourceMediaType ? (
            <div className="export-inline-note">
              Direct source encoding uses the complete media file. Timeline-only outputs and In/Out markers are bypassed.
            </div>
          ) : mode.isVideoMode ? (
            <div className="export-field-card export-subcard" data-export-target="basic-workflow">
              <div className="export-field-head">
                <span>Workflow</span>
                <strong>{display.methodMeta.title}</strong>
              </div>
              <div className="export-chip-row">
                {mode.webCodecsAvailable && (
                  <button
                    type="button"
                    className={`export-chip${mode.encoder === 'webcodecs' ? ' is-active' : ''}`}
                    onClick={() => actions.setEncoder('webcodecs')}
                    aria-label="Use WebCodecs Fast export"
                    aria-pressed={mode.encoder === 'webcodecs'}
                  >
                    WebCodecs
                  </button>
                )}
                {mode.webCodecsAvailable && (
                  <button
                    type="button"
                    className={`export-chip${mode.encoder === 'htmlvideo' ? ' is-active' : ''}`}
                    onClick={() => actions.setEncoder('htmlvideo')}
                  >
                    HTMLVideo
                  </button>
                )}
                {mode.ffmpegAvailable && (
                  <button
                    type="button"
                    className={`export-chip${mode.encoder === 'ffmpeg' ? ' is-active' : ''}`}
                    onClick={() => actions.setEncoder('ffmpeg')}
                  >
                    FFmpeg
                  </button>
                )}
              </div>

              {mode.encoder === 'ffmpeg' && (
                <div className="export-status-row">
                  {!mode.isFFmpegReady ? (
                    <button
                      type="button"
                      onClick={actions.loadFFmpeg}
                      disabled={mode.isFFmpegLoading}
                      className="btn-small export-status-button"
                    >
                      {mode.isFFmpegLoading ? 'Loading FFmpeg...' : 'Load FFmpeg Runtime'}
                    </button>
                  ) : (
                    <span className="export-status-ok">
                      FFmpeg Ready
                    </span>
                  )}
                </div>
              )}

              {mode.ffmpegLoadError && mode.encoder === 'ffmpeg' && (
                <div className="export-error export-error-inline">
                  {mode.ffmpegLoadError}
                </div>
              )}
            </div>
          ) : mode.isXmlMode ? (
            <div className="export-inline-note">
              XML export writes a Final Cut Pro interchange file from the current timeline instead of rendering media.
            </div>
          ) : mode.isImageMode ? (
            <div className="export-inline-note">
              {mode.isImageSequenceMode
                ? mode.imageSequenceFolderSupported
                  ? 'Image sequence export writes numbered frames into a selected folder.'
                  : 'Image sequence export uses a ZIP fallback because folder writes are not available in this browser.'
                : 'Image export renders exactly one frame at the current playhead position.'}
            </div>
          ) : mode.isAudioOnlyMode ? (
            <div className="export-inline-note">
              Audio-only export writes the selected audio file format.
            </div>
          ) : null}
        </div>

        <ExportVisualChannelCard
          mode={mode}
          display={display}
          video={video}
          image={image}
          gif={gif}
          options={options}
          time={time}
          useInOut={useInOut}
          actions={actions}
          sourceMediaType={sourceMediaType}
        />

        <ExportAudioChannelCard
          mode={mode}
          display={display}
          audio={audio}
          options={options}
          time={time}
          useInOut={useInOut}
          actions={actions}
          sourceMediaType={sourceMediaType}
        />
      </div>
    </div>
  );
}

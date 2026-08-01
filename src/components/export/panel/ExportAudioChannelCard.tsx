import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
} from './exportBasicsTypes';
import type { BatchExportMediaType } from '../../../stores/exportStore';

interface ExportAudioChannelCardProps {
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  audio: ExportBasicsAudioState;
  options: ExportBasicsOptionState;
  time: ExportBasicsTimeState;
  useInOut: boolean;
  actions: ExportBasicsActions;
  sourceMediaType?: BatchExportMediaType;
}

export function ExportAudioChannelCard({
  mode,
  display,
  audio,
  options,
  time,
  useInOut,
  actions,
  sourceMediaType,
}: ExportAudioChannelCardProps) {
  return (
    <div className={`export-channel-card${mode.isImageMode || mode.isGifMode || (!audio.includeAudio && !mode.isXmlMode) ? ' is-disabled' : ''}`} data-export-target="audio-section">
      <div className="export-channel-head">
        <div className="export-channel-title">
          <span>Audio</span>
          <strong>{mode.isGifMode ? 'Not supported' : mode.isXmlMode ? (audio.includeAudio ? 'Track references included' : 'No audio references') : !mode.isImageMode && audio.includeAudio ? `${display.currentAudioCodecLabel} / ${audio.audioSampleRate / 1000} kHz` : 'Disabled'}</strong>
        </div>
        <button
          type="button"
          className={`export-toggle${!mode.isGifMode && (mode.isXmlMode ? audio.includeAudio : !mode.isImageMode && audio.includeAudio) ? ' is-active' : ''}`}
          onClick={() => actions.setIncludeAudio(!audio.includeAudio)}
          disabled={mode.isImageMode || mode.isGifMode || (!mode.isXmlMode && mode.browserAudioUnavailable) || (sourceMediaType !== undefined && sourceMediaType !== 'video')}
          title={sourceMediaType && sourceMediaType !== 'video' ? 'The audio channel is fixed by the source media type' : undefined}
        >
          {!mode.isGifMode && (mode.isXmlMode ? audio.includeAudio : !mode.isImageMode && audio.includeAudio) ? 'On' : 'Off'}
        </button>
      </div>

      {mode.isImageMode ? (
        <div className="export-inline-note">
          Image export ignores audio and renders only the current playhead frame.
        </div>
      ) : mode.isGifMode ? (
        <div className="export-inline-note">
          GIF export is silent.
        </div>
      ) : mode.isXmlMode ? (
        <div className="export-inline-note">
          XML export can include or omit audio track references, but it does not encode audio files.
        </div>
      ) : audio.includeAudio ? (
        <>
          <div className="export-field-card export-subcard" data-export-target="audio-format">
            <div className="export-field-head">
              <span>Format</span>
              <strong>{display.currentAudioCodecLabel}</strong>
            </div>
            <div className="export-chip-row">
              {mode.isAudioOnlyMode ? (
                <>
                  <button
                    type="button"
                    className={`export-chip${audio.audioOnlyFormat === 'wav' ? ' is-active' : ''}`}
                    onClick={() => actions.setAudioOnlyFormat('wav')}
                  >
                    WAV PCM
                  </button>
                  <button
                    type="button"
                    className={`export-chip${audio.audioOnlyFormat === 'mp3' ? ' is-active' : ''}`}
                    onClick={() => actions.setAudioOnlyFormat('mp3')}
                  >
                    MP3
                  </button>
                  <button
                    type="button"
                    className={`export-chip${audio.audioOnlyFormat === 'browser' ? ' is-active' : ''}`}
                    onClick={() => actions.setAudioOnlyFormat('browser')}
                    disabled={!mode.isAudioSupported}
                  >
                    {display.browserAudioCodecLabel}
                  </button>
                </>
              ) : (
                <span className="export-chip export-chip-static">
                  {display.currentAudioCodecLabel}{mode.videoEnabled && mode.encoder === 'ffmpeg' ? ' auto' : ''}
                </span>
              )}
              {options.audioSampleRatePresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`export-chip${audio.audioSampleRate === preset.value ? ' is-active' : ''}`}
                  onClick={() => actions.setAudioSampleRate(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="export-field-card export-subcard" data-export-target="audio-quality">
            <div className="export-field-head">
              <span>Quality</span>
              <strong>{mode.isAudioOnlyMode && audio.audioOnlyFormat === 'wav' ? '16-bit PCM' : `${Math.round(audio.audioBitrate / 1000)} kbps`}</strong>
            </div>
            <div className="export-chip-row">
              {mode.isAudioOnlyMode && audio.audioOnlyFormat === 'wav' ? (
                <span className="export-chip export-chip-static">16-bit PCM</span>
              ) : (
                options.audioBitratePresets.map((preset) => (
                  <button
                    type="button"
                    key={preset.value}
                    className={`export-chip${audio.audioBitrate === preset.value ? ' is-active' : ''}`}
                    onClick={() => actions.setAudioBitrate(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="export-field-card export-subcard" data-export-target="audio-processing">
            <div className="export-field-head">
              <span>Processing</span>
              <strong>{audio.normalizeAudio ? 'Normalized' : 'Direct'}</strong>
            </div>
            <div className="export-chip-row">
              <button
                type="button"
                className={`export-toggle${audio.normalizeAudio ? ' is-active' : ''}`}
                onClick={() => actions.setNormalizeAudio(!audio.normalizeAudio)}
                disabled={sourceMediaType !== undefined}
                title={sourceMediaType ? 'Direct source normalization is not available yet' : undefined}
              >
                Normalize
              </button>
              {mode.showRangeInAudio && (
                <button
                  type="button"
                  className={`export-toggle${useInOut ? ' is-active' : ''}`}
                  onClick={() => actions.setUseInOut(!useInOut)}
                >
                  Use In/Out
                </button>
              )}
            </div>

            {mode.browserAudioUnavailable && (
              <div className="export-inline-note export-inline-note-warning">
                Browser audio encoding is not available here. Video export still works.
              </div>
            )}

            {mode.showRangeInAudio && (
              <div className="export-stats-grid export-stats-grid-compact">
                <div className="export-stat-card">
                  <span>Output</span>
                  <strong>{display.currentAudioCodecLabel} only</strong>
                </div>
                <div className="export-stat-card">
                  <span>Duration</span>
                  <strong>{time.formatTime(time.endTime - time.startTime)}</strong>
                </div>
                <div className="export-stat-card">
                  <span>{display.sizeStatLabel}</span>
                  <strong>{display.estimatedSizeLabel}</strong>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="export-inline-note">
          Audio export is disabled. Video export stays silent until you turn audio back on.
        </div>
      )}
    </div>
  );
}

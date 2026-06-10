import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsModeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

interface ExportAdvancedAudioSectionProps {
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  audio: ExportBasicsAudioState;
  actions: ExportBasicsActions;
}

export function ExportAdvancedAudioSection({
  mode,
  display,
  video,
  audio,
  actions,
}: ExportAdvancedAudioSectionProps) {
  return (
    <div className="export-section export-advanced-section">
      <div className="export-section-header">Advanced Audio</div>

      <div className="control-row">
        <label>
            <input
              type="checkbox"
              checked={audio.includeAudio}
              onChange={(e) => actions.setIncludeAudio(e.target.checked)}
              disabled={mode.isGifMode || mode.browserAudioUnavailable}
            />
            Include Audio
          </label>
        {mode.isGifMode && (
          <span style={{ color: 'var(--text-secondary)', fontSize: '11px', marginLeft: '8px' }}>
            GIF is silent
          </span>
        )}
        {mode.browserAudioUnavailable && (
          <span style={{ color: 'var(--warning)', fontSize: '11px', marginLeft: '8px' }}>
            Not supported
          </span>
        )}
      </div>

      {audio.includeAudio && !mode.isGifMode && (
        <>
          <div className="control-row">
            <label>Sample Rate</label>
            <select
              value={audio.audioSampleRate}
              onChange={(e) => actions.setAudioSampleRate(Number(e.target.value) as 44100 | 48000)}
            >
              <option value={48000}>48 kHz (Video)</option>
              <option value={44100}>44.1 kHz (CD)</option>
            </select>
          </div>

          <div className="control-row">
            <label>Audio Quality</label>
            {mode.isAudioOnlyMode && audio.audioOnlyFormat === 'wav' ? (
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                16-bit PCM
              </span>
            ) : (
              <select
                value={audio.audioBitrate}
                onChange={(e) => actions.setAudioBitrate(Number(e.target.value))}
              >
                <option value={128000}>128 kbps</option>
                <option value={192000}>192 kbps</option>
                <option value={256000}>256 kbps (High)</option>
                <option value={320000}>320 kbps (Max)</option>
              </select>
            )}
          </div>

          {(mode.encoder === 'ffmpeg' || mode.isAudioOnlyMode) && (
            <div className="control-row">
              <label>Audio Codec</label>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {mode.isAudioOnlyMode
                  ? display.currentAudioCodecLabel
                  : `${video.ffmpegContainer === 'mov' ? 'AAC' :
                     video.ffmpegContainer === 'mkv' ? 'FLAC' :
                     video.ffmpegContainer === 'avi' ? 'PCM' :
                     video.ffmpegContainer === 'mxf' ? 'PCM' : 'AAC'} (auto)`}
              </span>
            </div>
          )}

          <div className="control-row">
            <label>
              <input
                type="checkbox"
                checked={audio.normalizeAudio}
                onChange={(e) => actions.setNormalizeAudio(e.target.checked)}
              />
              Normalize (prevent clipping)
            </label>
          </div>
        </>
      )}
    </div>
  );
}

import { FrameExporter } from '../../../engine/export';
import type { ContainerFormat, VideoCodec } from '../../../engine/export';
import { getExportDialogSummary } from './exportDialogFormat';

interface ExportSettingsFormProps {
  filename: string;
  container: ContainerFormat;
  codec: VideoCodec;
  codecSupport: Record<VideoCodec, boolean>;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  useCustomBitrate: boolean;
  stackedAlpha: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  includeAudio: boolean;
  audioSampleRate: 44100 | 48000;
  audioBitrate: number;
  normalizeAudio: boolean;
  error: string | null;
  onClose: () => void;
  onExport: () => void;
  setFilename: (filename: string) => void;
  setContainer: (container: ContainerFormat) => void;
  setCodec: (codec: VideoCodec) => void;
  onResolutionChange: (value: string) => void;
  setFps: (fps: number) => void;
  setBitrate: (bitrate: number) => void;
  setUseCustomBitrate: (useCustomBitrate: boolean) => void;
  setStackedAlpha: (stackedAlpha: boolean) => void;
  setStartTime: (startTime: number) => void;
  setEndTime: (endTime: number) => void;
  setIncludeAudio: (includeAudio: boolean) => void;
  setAudioSampleRate: (audioSampleRate: 44100 | 48000) => void;
  setAudioBitrate: (audioBitrate: number) => void;
  setNormalizeAudio: (normalizeAudio: boolean) => void;
}

export function ExportSettingsForm({
  filename,
  container,
  codec,
  codecSupport,
  width,
  height,
  fps,
  bitrate,
  useCustomBitrate,
  stackedAlpha,
  startTime,
  endTime,
  duration,
  includeAudio,
  audioSampleRate,
  audioBitrate,
  normalizeAudio,
  error,
  onClose,
  onExport,
  setFilename,
  setContainer,
  setCodec,
  onResolutionChange,
  setFps,
  setBitrate,
  setUseCustomBitrate,
  setStackedAlpha,
  setStartTime,
  setEndTime,
  setIncludeAudio,
  setAudioSampleRate,
  setAudioBitrate,
  setNormalizeAudio,
}: ExportSettingsFormProps) {
  const summary = getExportDialogSummary({
    width,
    height,
    fps,
    bitrate,
    startTime,
    endTime,
    stackedAlpha,
  });

  return (
    <>
      <div className="export-form">
        <div className="export-row">
          <label>Filename</label>
          <div className="export-input-group">
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="export"
            />
            <span className="export-extension">
              {FrameExporter.getContainerFormats().find(c => c.id === container)?.extension ?? '.mp4'}
            </span>
          </div>
        </div>

        <div className="export-row">
          <label>Container</label>
          <select
            value={container}
            onChange={(e) => setContainer(e.target.value as ContainerFormat)}
          >
            {FrameExporter.getContainerFormats().map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="export-row">
          <label>Codec</label>
          <select
            value={codec}
            onChange={(e) => setCodec(e.target.value as VideoCodec)}
          >
            {FrameExporter.getVideoCodecs(container).map(({ id, label, description }) => (
              <option
                key={id}
                value={id}
                disabled={!codecSupport[id]}
                title={description}
              >
                {label} {!codecSupport[id] ? '(not supported)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="export-row">
          <label>Resolution</label>
          <select
            value={`${width}x${height}`}
            onChange={(e) => onResolutionChange(e.target.value)}
          >
            {FrameExporter.getPresetResolutions().map(({ label, width: w, height: h }) => (
              <option key={`${w}x${h}`} value={`${w}x${h}`}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="export-row">
          <label>Frame Rate</label>
          <select
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          >
            {FrameExporter.getPresetFrameRates().map(({ label, fps: f }) => (
              <option key={f} value={f}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="export-row">
          <label>Quality</label>
          <div className="export-bitrate-group">
            {!useCustomBitrate ? (
              <select
                value={bitrate}
                onChange={(e) => setBitrate(Number(e.target.value))}
              >
                <option value={5_000_000}>Low (5 Mbps)</option>
                <option value={10_000_000}>Medium (10 Mbps)</option>
                <option value={15_000_000}>High (15 Mbps)</option>
                <option value={25_000_000}>Very High (25 Mbps)</option>
                <option value={35_000_000}>Maximum (35 Mbps)</option>
                <option value={50_000_000}>Ultra (50 Mbps)</option>
              </select>
            ) : (
              <div className="export-custom-bitrate">
                <input
                  type="range"
                  min={FrameExporter.getBitrateRange().min}
                  max={FrameExporter.getBitrateRange().max}
                  step={FrameExporter.getBitrateRange().step}
                  value={bitrate}
                  onChange={(e) => setBitrate(Number(e.target.value))}
                />
                <span className="bitrate-value">{FrameExporter.formatBitrate(bitrate)}</span>
              </div>
            )}
            <button
              type="button"
              className="bitrate-toggle"
              onClick={() => setUseCustomBitrate(!useCustomBitrate)}
              title={useCustomBitrate ? 'Use presets' : 'Custom bitrate'}
            >
              {useCustomBitrate ? 'Presets' : 'Custom'}
            </button>
          </div>
        </div>

        <div className="export-row">
          <label>Alpha</label>
          <div className="export-checkbox-group">
            <input
              type="checkbox"
              id="stackedAlpha"
              checked={stackedAlpha}
              onChange={(e) => setStackedAlpha(e.target.checked)}
            />
            <label htmlFor="stackedAlpha" className="checkbox-label">
              Stacked Alpha (transparent video)
            </label>
          </div>
        </div>
        {stackedAlpha && (
          <div className="export-warning">
            Video height is doubled ({height} &rarr; {height * 2}px). Top half = RGB, bottom half = alpha as grayscale.
            Use a stacked-alpha player or shader to composite.
          </div>
        )}

        <div className="export-row">
          <label>Time Range</label>
          <div className="export-time-range">
            <input
              type="number"
              value={startTime.toFixed(2)}
              onChange={(e) => setStartTime(Math.max(0, Number(e.target.value)))}
              step="0.1"
              min="0"
              max={endTime}
            />
            <span>to</span>
            <input
              type="number"
              value={endTime.toFixed(2)}
              onChange={(e) => setEndTime(Math.min(duration, Number(e.target.value)))}
              step="0.1"
              min={startTime}
              max={duration}
            />
            <span>sec</span>
          </div>
        </div>

        <div className="export-section-header">Audio</div>

        <div className="export-row">
          <label>Include Audio</label>
          <div className="export-checkbox-group">
            <input
              type="checkbox"
              id="includeAudio"
              checked={includeAudio}
              onChange={(e) => setIncludeAudio(e.target.checked)}
            />
            <label htmlFor="includeAudio" className="checkbox-label">
              Export audio tracks (AAC)
            </label>
          </div>
        </div>

        {includeAudio && (
          <>
            <div className="export-row">
              <label>Sample Rate</label>
              <select
                value={audioSampleRate}
                onChange={(e) => setAudioSampleRate(Number(e.target.value) as 44100 | 48000)}
              >
                <option value={48000}>48 kHz (Video Standard)</option>
                <option value={44100}>44.1 kHz (CD Quality)</option>
              </select>
            </div>

            <div className="export-row">
              <label>Audio Quality</label>
              <select
                value={audioBitrate}
                onChange={(e) => setAudioBitrate(Number(e.target.value))}
              >
                <option value={128000}>128 kbps (Good)</option>
                <option value={192000}>192 kbps (Better)</option>
                <option value={256000}>256 kbps (High Quality)</option>
                <option value={320000}>320 kbps (Maximum)</option>
              </select>
            </div>

            <div className="export-row">
              <label>Normalize</label>
              <div className="export-checkbox-group">
                <input
                  type="checkbox"
                  id="normalizeAudio"
                  checked={normalizeAudio}
                  onChange={(e) => setNormalizeAudio(e.target.checked)}
                />
                <label htmlFor="normalizeAudio" className="checkbox-label">
                  Peak normalize (prevent clipping)
                </label>
              </div>
            </div>
          </>
        )}

        <div className="export-summary">
          <div>Output: {summary.output} {summary.stackedAlphaLabel}</div>
          <div>Duration: {summary.duration}</div>
          <div>Total Frames: {summary.totalFrames}</div>
          <div>Estimated Size: {summary.estimatedSize}</div>
        </div>
      </div>

      {error && <div className="export-error">{error}</div>}

      <div className="export-actions">
        <button className="export-cancel" onClick={onClose}>
          Cancel
        </button>
        <button className="export-start" onClick={onExport}>
          Export
        </button>
      </div>
    </>
  );
}

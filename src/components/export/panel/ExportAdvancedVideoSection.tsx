import { FrameExporter } from '../../../engine/export';
import type { ContainerFormat, VideoCodec } from '../../../engine/export';
import {
  DNXHR_PROFILES,
  PRORES_PROFILES,
} from '../../../engine/ffmpeg';
import type {
  DnxhrProfile,
  FFmpegContainer,
  ProResProfile,
} from '../../../engine/ffmpeg';
import { getGifPaletteModeLabel } from '../../../engine/gif/gifOptions';
import { CodecSelector } from '../CodecSelector';
import type {
  ExportBasicsActions,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

interface ExportAdvancedVideoSectionProps {
  filename: string;
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  gif: ExportBasicsGifState;
  options: ExportBasicsOptionState;
  actions: ExportBasicsActions;
}

export function ExportAdvancedVideoSection({
  filename,
  mode,
  display,
  video,
  gif,
  options,
  actions,
}: ExportAdvancedVideoSectionProps) {
  return (
    <div className="export-section export-advanced-section">
      <div className="export-section-header">Advanced Video</div>

      {/* Filename */}
      <div className="control-row">
        <label>Filename</label>
        <div className="export-input-group">
          <input
            type="text"
            value={filename}
            onChange={(e) => actions.setFilename(e.target.value)}
            placeholder="export"
          />
          <select
            className="export-extension-select"
            value={display.currentContainerId}
            onChange={(e) => {
              const nextContainer = e.target.value;
              if (nextContainer === 'gif') {
                actions.setSpecialContainer('none');
                actions.setVideoEnabled(true);
                actions.setVisualMode('gif');
                actions.setIncludeAudio(false);
              } else if (mode.isWebCodecsEncoder) {
                actions.setVisualMode('video');
                actions.setContainerFormat(nextContainer as ContainerFormat);
              } else {
                actions.setVisualMode('video');
                actions.handleFFmpegContainerChange(nextContainer as FFmpegContainer);
              }
            }}
            title="Click to change container format"
          >
            {options.videoContainerFormats.map(({ id }) => (
              <option key={id} value={id}>.{id}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Video Codec */}
      <div className="control-row">
        <label>Codec</label>
        {mode.isGifMode ? (
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {display.currentCodecLabel}
          </span>
        ) : (mode.encoder === 'webcodecs' || mode.encoder === 'htmlvideo') ? (
          <select
            value={video.videoCodec}
            onChange={(e) => actions.setVideoCodec(e.target.value as VideoCodec)}
          >
            {FrameExporter.getVideoCodecs(video.containerFormat).map(({ id, label }) => (
              <option key={id} value={id} disabled={!video.codecSupport[id]}>
                {label} {!video.codecSupport[id] ? '(not supported)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <CodecSelector
            container={video.ffmpegContainer}
            value={video.ffmpegCodec}
            onChange={actions.handleFFmpegCodecChange}
          />
        )}
      </div>

      {/* FFmpeg Codec description */}
      {(mode.encoder === 'ffmpeg' || mode.isGifMode) && display.ffmpegCodecInfo && (
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '-4px', marginBottom: '8px', paddingLeft: '4px' }}>
          {display.ffmpegCodecInfo.description}
          {display.ffmpegCodecInfo.supportsAlpha && ' | Alpha'}
          {display.ffmpegCodecInfo.supports10bit && ' | 10-bit'}
        </div>
      )}

      {/* FFmpeg ProRes Profile */}
      {mode.encoder === 'ffmpeg' && !mode.isGifMode && video.ffmpegCodec === 'prores' && (
        <div className="control-row">
          <label>Profile</label>
          <select
            value={video.proresProfile}
            onChange={(e) => actions.setProresProfile(e.target.value as ProResProfile)}
          >
            {PRORES_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} - {p.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* FFmpeg DNxHR Profile */}
      {mode.encoder === 'ffmpeg' && !mode.isGifMode && video.ffmpegCodec === 'dnxhd' && (
        <div className="control-row">
          <label>Profile</label>
          <select
            value={video.dnxhrProfile}
            onChange={(e) => actions.setDnxhrProfile(e.target.value as DnxhrProfile)}
          >
            {DNXHR_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} - {p.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* HAP codec removed - requires snappy which doesn't build with ASYNCIFY */}

      {/* Resolution */}
      <div className="control-row">
        <label>Resolution</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={video.useCustomResolution ? 'custom' : `${video.width}x${video.height}`}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                actions.setUseCustomResolution(true);
              } else {
                actions.setUseCustomResolution(false);
                actions.handleResolutionChange(e.target.value);
              }
            }}
            disabled={video.useCustomResolution}
            style={{ flex: 1 }}
          >
            {options.quickResolutionPresets.map(({ label, width: w, height: h }) => (
              <option key={`${w}x${h}`} value={`${w}x${h}`}>
                {label}
              </option>
            ))}
            <option value="custom">Custom...</option>
          </select>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="checkbox"
              checked={video.useCustomResolution}
              onChange={(e) => actions.setUseCustomResolution(e.target.checked)}
            />
            Custom
          </label>
        </div>
      </div>

      {/* Custom Resolution Inputs */}
      {video.useCustomResolution && (
        <div className="control-row">
          <label>Custom Size</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              value={video.customWidth}
              onChange={(e) => actions.setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
              placeholder="Width"
              min="1"
              max="7680"
              style={{ flex: 1 }}
            />
            <span>×</span>
            <input
              type="number"
              value={video.customHeight}
              onChange={(e) => actions.setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
              placeholder="Height"
              min="1"
              max="4320"
              style={{ flex: 1 }}
            />
          </div>
        </div>
      )}

      {/* Frame Rate */}
      <div className="control-row">
        <label>Frame Rate</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!video.useCustomFps ? (
            <select
              value={video.fps}
              onChange={(e) => actions.setFps(Number(e.target.value))}
              style={{ flex: 1 }}
            >
              <option value={23.976}>23.976 fps (Film)</option>
              <option value={24}>24 fps (Cinema)</option>
              <option value={25}>25 fps (PAL)</option>
              <option value={29.97}>29.97 fps (NTSC)</option>
              <option value={30}>30 fps</option>
              <option value={48}>48 fps (HFR)</option>
              <option value={50}>50 fps (PAL)</option>
              <option value={59.94}>59.94 fps (NTSC)</option>
              <option value={60}>60 fps</option>
              <option value={120}>120 fps</option>
            </select>
          ) : (
            <input
              type="number"
              value={video.customFps}
              onChange={(e) => actions.setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
              min={1}
              max={240}
              step={0.001}
              style={{ flex: 1 }}
            />
          )}
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={video.useCustomFps}
              onChange={(e) => actions.setUseCustomFps(e.target.checked)}
            />
            Custom
          </label>
        </div>
      </div>

      {/* Quality - different controls for each encoder */}
      {mode.isGifMode ? (
        <div className="control-row">
          <label>GIF Palette</label>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {gif.gifColors} colors, {getGifPaletteModeLabel(gif.gifPaletteMode)}, {display.estimatedSizeLabel}
          </span>
        </div>
      ) : (mode.encoder === 'webcodecs' || mode.encoder === 'htmlvideo') ? (
        <>
          {/* Rate Control */}
          <div className="control-row">
            <label>Rate Control</label>
            <select
              value={video.rateControl}
              onChange={(e) => actions.setRateControl(e.target.value as 'vbr' | 'cbr')}
            >
              <option value="vbr">VBR (Variable Bitrate)</option>
              <option value="cbr">CBR (Constant Bitrate)</option>
            </select>
          </div>

          {/* Bitrate */}
          <div className="control-row">
            <label>{video.rateControl === 'cbr' ? 'Bitrate' : 'Target Bitrate'}</label>
            <select
              value={video.bitrate}
              onChange={(e) => actions.setBitrate(Number(e.target.value))}
            >
              <option value={5_000_000}>5 Mbps (Low)</option>
              <option value={10_000_000}>10 Mbps (Medium)</option>
              <option value={15_000_000}>15 Mbps (High)</option>
              <option value={20_000_000}>20 Mbps</option>
              <option value={25_000_000}>25 Mbps (Very High)</option>
              <option value={35_000_000}>35 Mbps</option>
              <option value={50_000_000}>50 Mbps (Max)</option>
            </select>
          </div>

          {/* Bitrate Slider */}
          <div className="control-row">
            <label></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
              <input
                type="range"
                min={1_000_000}
                max={100_000_000}
                step={500_000}
                value={video.bitrate}
                onChange={(e) => actions.setBitrate(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: '70px', fontSize: '12px', textAlign: 'right' }}>
                {(video.bitrate / 1_000_000).toFixed(1)} Mbps
              </span>
            </div>
          </div>
        </>
      ) : mode.showFFmpegQualityControl && (
        /* MJPEG Quality Control - lower values = higher quality */
        <div className="control-row">
          <label>Quality</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <input
              type="range"
              min={1}
              max={31}
              value={video.ffmpegQuality}
              onChange={(e) => actions.setFfmpegQuality(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: '60px', textAlign: 'right', fontSize: '12px' }}>
              {video.ffmpegQuality} {video.ffmpegQuality <= 5 ? '(High)' : video.ffmpegQuality <= 10 ? '(Good)' : video.ffmpegQuality <= 20 ? '(Med)' : '(Low)'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

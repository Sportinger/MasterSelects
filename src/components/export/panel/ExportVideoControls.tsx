import { useState } from 'react';
import {
  GIF_COLOR_PRESETS,
  GIF_DITHER_OPTIONS,
  GIF_PALETTE_MODES,
  clampGifBayerScale,
  clampGifColors,
  clampGifLoopCount,
  getGifDitherLabel,
  getGifPaletteModeLabel,
} from '../../../engine/gif/gifOptions';
import { ExportVideoCodecCard } from './ExportVideoCodecCard';
import type {
  ExportBasicsActions,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

interface ExportVideoControlsProps {
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  gif: ExportBasicsGifState;
  options: ExportBasicsOptionState;
  useInOut: boolean;
  actions: ExportBasicsActions;
}

export function ExportVideoControls({
  mode,
  display,
  video,
  gif,
  options,
  useInOut,
  actions,
}: ExportVideoControlsProps) {
  const [orientationPreviewLocked, setOrientationPreviewLocked] = useState(false);
  const isPortrait = video.actualHeight > video.actualWidth;
  const toggleResolutionOrientation = () => {
    if (video.useCustomResolution) {
      actions.setCustomWidth(video.actualHeight);
      actions.setCustomHeight(video.actualWidth);
      return;
    }
    actions.handleQuickResolutionPreset(`${video.actualHeight}x${video.actualWidth}`);
  };

  return (
    <>
      <div className="export-quick-grid">
        <div className="export-field-card export-subcard" data-export-target="video-resolution">
          <div className="export-field-head">
            <span>Resolution</span>
            <div className="export-resolution-value">
              <button
                type="button"
                className={`export-orientation-toggle${orientationPreviewLocked ? ' is-preview-locked' : ''}`}
                onClick={() => {
                  toggleResolutionOrientation();
                  setOrientationPreviewLocked(true);
                }}
                onMouseLeave={() => setOrientationPreviewLocked(false)}
                onBlur={() => setOrientationPreviewLocked(false)}
                aria-label={`Switch to ${isPortrait ? '16:9 landscape' : '9:16 portrait'}`}
                title={`Switch to ${isPortrait ? '16:9 landscape' : '9:16 portrait'}`}
              >
                <span className={`export-orientation-icon${isPortrait ? ' is-portrait' : ''}`} aria-hidden="true" />
                <svg className="export-orientation-preview" viewBox="0 0 24 24" aria-hidden="true">
                  <path className="export-orientation-preview-arc" d="M4 18A14 14 0 0 1 18 4" />
                  <path className="export-orientation-preview-head" d="M13 4h5v5" />
                </svg>
              </button>
              <strong>{video.actualWidth}x{video.actualHeight}</strong>
            </div>
          </div>
          <div className="export-chip-row">
            {options.quickResolutionPresets.map(({ label, width: presetWidth, height: presetHeight }) => (
              <button
                key={`${presetWidth}x${presetHeight}`}
                type="button"
                className={`export-chip${!video.useCustomResolution && video.width === (isPortrait ? presetHeight : presetWidth) && video.height === (isPortrait ? presetWidth : presetHeight) ? ' is-active' : ''}`}
                onClick={() => actions.handleQuickResolutionPreset(isPortrait ? `${presetHeight}x${presetWidth}` : `${presetWidth}x${presetHeight}`)}
              >
                {label.split(' ')[0]}
              </button>
            ))}
            <button
              type="button"
              className={`export-chip${video.useCustomResolution ? ' is-active' : ''}`}
              onClick={() => actions.setUseCustomResolution(true)}
            >
              Custom
            </button>
          </div>
          {video.useCustomResolution && (
            <div className="export-inline-inputs">
              <input
                type="number"
                value={video.customWidth}
                onChange={(e) => actions.setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                placeholder="Width"
                min="1"
                max="7680"
              />
              <span>x</span>
              <input
                type="number"
                value={video.customHeight}
                onChange={(e) => actions.setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                placeholder="Height"
                min="1"
                max="4320"
              />
            </div>
          )}
        </div>

        <div className="export-field-card export-subcard" data-export-target="video-fps">
          <div className="export-field-head">
            <span>Frame Rate</span>
            <strong>{video.actualFps} fps</strong>
          </div>
          <div className="export-chip-row">
            {options.quickFrameRatePresets.map((presetFps) => (
              <button
                key={presetFps}
                type="button"
                className={`export-chip${!video.useCustomFps && video.fps === presetFps ? ' is-active' : ''}`}
                onClick={() => actions.handleQuickFpsPreset(presetFps)}
              >
                {presetFps} fps
              </button>
            ))}
            <button
              type="button"
              className={`export-chip${video.useCustomFps ? ' is-active' : ''}`}
              onClick={() => actions.setUseCustomFps(true)}
            >
              Custom
            </button>
          </div>
          {video.useCustomFps && (
            <div className="export-inline-inputs export-inline-inputs-single">
              <input
                type="number"
                value={video.customFps}
                onChange={(e) => actions.setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                min={1}
                max={240}
                step={0.001}
              />
            </div>
          )}
        </div>
      </div>

      {(mode.isGifMode || mode.isWebCodecsEncoder || mode.showFFmpegQualityControl) && (
        <div className="export-field-card export-subcard" data-export-target={mode.isGifMode ? 'gif-palette' : 'video-rate'}>
          <div className="export-field-head">
            <span>{mode.isGifMode ? 'Palette' : mode.isWebCodecsEncoder ? 'Rate' : 'Quality'}</span>
            <strong>
              {mode.isGifMode
                ? `${gif.gifColors} colors / ${getGifPaletteModeLabel(gif.gifPaletteMode)} / ${gif.gifTransparency ? 'Alpha' : 'Opaque'}`
                : mode.isWebCodecsEncoder
                ? `${video.rateControl.toUpperCase()} / ${(video.bitrate / 1_000_000).toFixed(1)} Mbps`
                : `MJPEG / Q${video.ffmpegQuality}`}
            </strong>
          </div>
          {mode.isGifMode ? (
            <>
              <div className="export-chip-row">
                {GIF_COLOR_PRESETS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`export-chip${gif.gifColors === value ? ' is-active' : ''}`}
                    onClick={() => actions.setGifColors(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="export-inline-inputs export-inline-inputs-single">
                <input
                  type="number"
                  value={gif.gifColors}
                  onChange={(e) => actions.setGifColors(clampGifColors(Number(e.target.value)))}
                  min={2}
                  max={256}
                  step={1}
                  aria-label="GIF color count"
                />
              </div>
              <div className="export-chip-row">
                {GIF_PALETTE_MODES.map((paletteMode) => (
                  <button
                    key={paletteMode.id}
                    type="button"
                    className={`export-chip${gif.gifPaletteMode === paletteMode.id ? ' is-active' : ''}`}
                    onClick={() => actions.setGifPaletteMode(paletteMode.id)}
                  >
                    {paletteMode.label}
                  </button>
                ))}
              </div>
              <div className="export-chip-row">
                {GIF_DITHER_OPTIONS.map((dither) => (
                  <button
                    key={dither.id}
                    type="button"
                    className={`export-chip${gif.gifDither === dither.id ? ' is-active' : ''}`}
                    onClick={() => actions.setGifDither(dither.id)}
                    disabled={mode.isWebCodecsEncoder}
                  >
                    {dither.label}
                  </button>
                ))}
              </div>
              {!mode.isWebCodecsEncoder && gif.gifDither === 'bayer' && (
                <div className="export-slider-control">
                  <div className="export-slider-head">
                    <label>Bayer Scale</label>
                    <span className="export-slider-value">{gif.gifBayerScale}</span>
                  </div>
                  <input
                    className="export-slider-input"
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={gif.gifBayerScale}
                    onChange={(e) => actions.setGifBayerScale(clampGifBayerScale(Number(e.target.value)))}
                  />
                </div>
              )}
              <div className="export-chip-row">
                <button
                  type="button"
                  className={`export-chip${gif.gifLoop === 'forever' ? ' is-active' : ''}`}
                  onClick={() => actions.setGifLoop('forever')}
                >
                  Forever
                </button>
                <button
                  type="button"
                  className={`export-chip${gif.gifLoop === 'once' ? ' is-active' : ''}`}
                  onClick={() => actions.setGifLoop('once')}
                >
                  Once
                </button>
                <button
                  type="button"
                  className={`export-chip${gif.gifLoop === 'count' ? ' is-active' : ''}`}
                  onClick={() => actions.setGifLoop('count')}
                >
                  Count
                </button>
              </div>
              {gif.gifLoop === 'count' && (
                <div className="export-inline-inputs export-inline-inputs-single">
                  <input
                    type="number"
                    value={gif.gifLoopCount}
                    onChange={(e) => actions.setGifLoopCount(clampGifLoopCount(Number(e.target.value)))}
                    min={2}
                    max={99}
                    step={1}
                    aria-label="GIF loop count"
                  />
                </div>
              )}
              <div className="export-chip-row">
                <button
                  type="button"
                  className={`export-toggle${gif.gifOptimize ? ' is-active' : ''}`}
                  onClick={() => actions.setGifOptimize(!gif.gifOptimize)}
                  disabled={mode.isWebCodecsEncoder}
                >
                  Optimize
                </button>
                <button
                  type="button"
                  className={`export-toggle${gif.gifTransparency ? ' is-active' : ''}`}
                  onClick={() => actions.setGifTransparency(!gif.gifTransparency)}
                >
                  {gif.gifTransparency ? 'Transparent' : 'Opaque'}
                </button>
              </div>
              {gif.gifTransparency && (
                <div className="export-slider-control">
                  <div className="export-slider-head">
                    <label>Alpha Threshold</label>
                    <span className="export-slider-value">{gif.gifAlphaThreshold}</span>
                  </div>
                  <input
                    className="export-slider-input"
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={gif.gifAlphaThreshold}
                    onChange={(e) => actions.setGifAlphaThreshold(Number(e.target.value))}
                  />
                </div>
              )}
              <div className="export-inline-note">
                Estimated range: {display.gifSizeRangeLabel}. {mode.isWebCodecsEncoder ? 'Browser GIF uses fast quantization without dithering.' : `Dither: ${getGifDitherLabel(gif.gifDither)}.`}
              </div>
            </>
          ) : mode.isWebCodecsEncoder ? (
            <>
              <div className="export-chip-row">
                <button
                  type="button"
                  className={`export-chip${video.rateControl === 'vbr' ? ' is-active' : ''}`}
                  onClick={() => actions.setRateControl('vbr')}
                >
                  VBR
                </button>
                <button
                  type="button"
                  className={`export-chip${video.rateControl === 'cbr' ? ' is-active' : ''}`}
                  onClick={() => actions.setRateControl('cbr')}
                >
                  CBR
                </button>
              </div>
              <div className="export-chip-row">
                {options.webQualityPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`export-chip${video.bitrate === preset.value ? ' is-active' : ''}`}
                    onClick={() => actions.handleQuickBitratePreset(preset.value)}
                  >
                    {preset.detail}
                  </button>
                ))}
              </div>
              <div className="export-slider-control">
                <div className="export-slider-head">
                  <label>Fine Tune</label>
                  <span className="export-slider-value">{(video.bitrate / 1_000_000).toFixed(1)} Mbps</span>
                </div>
                <input
                  className="export-slider-input"
                  type="range"
                  min={1_000_000}
                  max={100_000_000}
                  step={500_000}
                  value={video.bitrate}
                  onChange={(e) => actions.setBitrate(Number(e.target.value))}
                />
              </div>
              <div className="export-inline-note">
                {display.webCodecsRateNote}
              </div>
            </>
          ) : (
            <div className="export-slider-control">
              <div className="export-slider-head">
                <label>MJPEG</label>
                <span className="export-slider-value">
                  {video.ffmpegQuality} {video.ffmpegQuality <= 5 ? '(High)' : video.ffmpegQuality <= 10 ? '(Good)' : video.ffmpegQuality <= 20 ? '(Med)' : '(Low)'}
                </span>
              </div>
              <input
                className="export-slider-input"
                type="range"
                min={1}
                max={31}
                value={video.ffmpegQuality}
                onChange={(e) => actions.setFfmpegQuality(parseInt(e.target.value))}
              />
            </div>
          )}
        </div>
      )}

      <ExportVideoCodecCard
        mode={mode}
        display={display}
        video={video}
        actions={actions}
      />

      <div className="export-field-card export-subcard" data-export-target="video-alpha">
        <div className="export-field-head">
          <span>{mode.isGifMode ? 'Transparency' : 'Alpha'}</span>
          <strong>{mode.isGifMode ? (gif.gifTransparency ? `Threshold ${gif.gifAlphaThreshold}` : 'Opaque') : video.stackedAlpha ? 'Stacked' : 'Off'}</strong>
        </div>
        <div className="export-chip-row">
          {!mode.isGifMode && (
            <button
              type="button"
              className={`export-toggle${video.stackedAlpha ? ' is-active' : ''}`}
              onClick={() => actions.setStackedAlpha(!video.stackedAlpha)}
              disabled={!mode.isWebCodecsEncoder}
            >
              Stacked Alpha
            </button>
          )}
          {mode.showRangeInVideo && (
            <button
              type="button"
              className={`export-toggle${useInOut ? ' is-active' : ''}`}
              onClick={() => actions.setUseInOut(!useInOut)}
            >
              Use In/Out
            </button>
          )}
        </div>
        {video.stackedAlpha && !mode.isGifMode && (
          <div className="export-inline-note export-inline-note-warning">
            Output becomes {video.actualWidth}x{video.actualHeight * 2}. Top half is RGB, bottom half is alpha as grayscale.
          </div>
        )}
        {mode.showRangeInVideo && (
          <div className="export-stats-grid export-stats-grid-compact">
            <div className="export-stat-card">
              <span>Output</span>
              <strong>{video.actualWidth}x{video.outputHeight}</strong>
            </div>
            <div className="export-stat-card">
              <span>Frames</span>
              <strong>{video.frameCount}</strong>
            </div>
            <div className="export-stat-card">
              <span>{display.sizeStatLabel}</span>
              <strong>{display.estimatedSizeLabel}</strong>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

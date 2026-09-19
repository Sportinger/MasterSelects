import { FrameExporter, type VideoCodec } from '../../../engine/export';
import {
  DNXHR_PROFILES,
  getCodecsForContainer,
  HAP_FORMATS,
  PRORES_PROFILES,
  type DnxhrProfile,
  type FFmpegVideoCodec,
  type HapFormat,
  type ProResProfile,
} from '../../../engine/ffmpeg';
import {
  GIF_DITHER_OPTIONS,
  GIF_PALETTE_MODES,
  clampGifBayerScale,
  clampGifColors,
  clampGifLoopCount,
  type GifDither,
  type GifPaletteMode,
} from '../../../engine/gif/gifOptions';
import type { BatchExportMediaType } from '../../../stores/exportStore';
import { ResolutionOrientationToggle } from '../../common/ResolutionOrientationToggle';
import type {
  ExportBasicsActions,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import {
  ExportInspectorMatchCheckbox,
  ExportInspectorNote,
  ExportInspectorRow,
  ExportInspectorSection,
  ExportInspectorToggle,
} from './ExportInspectorPrimitives';

interface ExportVideoInspectorSectionProps {
  actions: ExportBasicsActions;
  display: ExportBasicsDisplayState;
  gif: ExportBasicsGifState;
  mode: ExportBasicsModeState;
  options: ExportBasicsOptionState;
  sourceMediaType?: BatchExportMediaType;
  video: ExportBasicsVideoState;
}

function setNativeAlphaDefault(actions: ExportBasicsActions, enabled: boolean): void {
  actions.setIncludeAlpha(enabled);
  if (enabled) actions.setStackedAlpha(false);
}

function CodecControl({
  actions,
  display,
  mode,
  video,
}: Pick<ExportVideoInspectorSectionProps, 'actions' | 'display' | 'mode' | 'video'>) {
  if (mode.isGifMode) return <span className="export-inspector-static">{display.currentCodecLabel}</span>;

  if (mode.encoder === 'hap') {
    return (
      <InspectorSelect
        ariaLabel="HAP codec"
        groups={[{
          options: HAP_FORMATS.map(format => ({
            label: format.name,
            supportsAlpha: format.id === 'hap_alpha',
            value: format.id,
          })),
        }]}
        onChange={value => {
          const format = value as HapFormat;
          actions.setHapFormat(format);
          setNativeAlphaDefault(actions, format === 'hap_alpha');
        }}
        value={video.hapFormat}
      />
    );
  }

  if (mode.isWebCodecsEncoder) {
    return (
      <InspectorSelect
        ariaLabel="Video codec"
        onChange={value => actions.setVideoCodec(value as VideoCodec)}
        options={FrameExporter.getVideoCodecs(video.containerFormat).map(codec => ({
          disabled: !video.codecSupport[codec.id],
          label: codec.label,
          value: codec.id,
        }))}
        value={video.videoCodec}
      />
    );
  }

  return (
    <InspectorSelect
      ariaLabel="Video codec"
      groups={[{
        options: getCodecsForContainer(video.ffmpegContainer).map(codec => ({
          label: codec.name,
          supportsAlpha: codec.supportsAlpha,
          value: codec.id,
        })),
      }]}
      onChange={value => {
        const codec = value as FFmpegVideoCodec;
        actions.handleFFmpegCodecChange(codec);
        setNativeAlphaDefault(
          actions,
          codec === 'utvideo'
            || codec === 'ffv1'
            || codec === 'prores' && (video.proresProfile === '4444' || video.proresProfile === '4444xq'),
        );
      }}
      value={video.ffmpegCodec}
    />
  );
}

export function ExportVideoInspectorSection({
  actions,
  display,
  gif,
  mode,
  options,
  sourceMediaType,
  video,
}: ExportVideoInspectorSectionProps) {
  const isPortrait = video.actualHeight > video.actualWidth;
  const resolutionMatched = video.compositionMatchingAvailable && video.matchCompositionResolution;
  const frameRateMatched = video.compositionMatchingAvailable && video.matchCompositionFrameRate;
  const resolutionValue = video.useCustomResolution ? 'custom' : `${video.actualWidth}x${video.actualHeight}`;
  const frameRateValue = video.useCustomFps ? 'custom' : String(video.actualFps);
  const canToggleVideo = sourceMediaType === undefined;

  const toggleResolutionOrientation = () => {
    if (video.useCustomResolution) {
      actions.setCustomWidth(video.actualHeight);
      actions.setCustomHeight(video.actualWidth);
      return;
    }
    actions.handleQuickResolutionPreset(`${video.actualHeight}x${video.actualWidth}`);
  };

  const handleVideoEnabledChange = (enabled: boolean) => {
    actions.setVideoEnabled(enabled);
    if (enabled) {
      actions.setSpecialContainer('none');
      actions.setVisualMode('video');
    }
  };

  return (
    <ExportInspectorSection
      defaultOpen={mode.videoEnabled}
      enabled={mode.videoEnabled}
      indicator={mode.videoEnabled ? 'active' : 'inactive'}
      onEnabledChange={canToggleVideo ? handleVideoEnabledChange : undefined}
      target="video-section"
      title={mode.isGifMode ? 'GIF' : 'Video'}
    >
      {!mode.videoEnabled ? (
        <ExportInspectorNote>The visual channel is disabled. This export will contain audio only.</ExportInspectorNote>
      ) : (
        <>
          <ExportInspectorRow label="Codec" target="video-codec">
            <CodecControl actions={actions} display={display} mode={mode} video={video} />
          </ExportInspectorRow>

          {mode.encoder === 'ffmpeg' && !mode.isGifMode && video.ffmpegCodec === 'prores' && (
            <ExportInspectorRow label="Profile">
              <InspectorSelect
                ariaLabel="ProRes profile"
                groups={[{
                  options: PRORES_PROFILES.map(profile => ({
                    label: profile.name,
                    supportsAlpha: profile.id === '4444' || profile.id === '4444xq',
                    value: profile.id,
                  })),
                }]}
                onChange={value => {
                  const profile = value as ProResProfile;
                  actions.setProresProfile(profile);
                  setNativeAlphaDefault(actions, profile === '4444' || profile === '4444xq');
                }}
                value={video.proresProfile}
              />
            </ExportInspectorRow>
          )}

          {mode.encoder === 'ffmpeg' && !mode.isGifMode && video.ffmpegCodec === 'dnxhd' && (
            <ExportInspectorRow label="Profile">
              <InspectorSelect
                ariaLabel="DNxHR profile"
                onChange={value => actions.setDnxhrProfile(value as DnxhrProfile)}
                options={DNXHR_PROFILES.map(profile => ({ label: profile.name, value: profile.id }))}
                value={video.dnxhrProfile}
              />
            </ExportInspectorRow>
          )}

          <ExportInspectorRow
            actions={video.compositionMatchingAvailable ? (
              <ExportInspectorMatchCheckbox
                checked={video.matchCompositionResolution}
                label="Match composition resolution"
                onChange={actions.setMatchCompositionResolution}
              />
            ) : undefined}
            className={resolutionMatched ? 'is-composition-matched' : undefined}
            label="Resolution"
            target="video-resolution"
          >
            <div className="export-inspector-inline">
              <ResolutionOrientationToggle
                disabled={resolutionMatched}
                height={video.actualHeight}
                onToggle={toggleResolutionOrientation}
                width={video.actualWidth}
              />
              <InspectorSelect
                ariaLabel="Video resolution"
                disabled={resolutionMatched}
                onChange={value => {
                  if (value === 'custom') {
                    actions.setUseCustomResolution(true);
                  } else {
                    actions.handleQuickResolutionPreset(value);
                  }
                }}
                options={[
                  ...options.quickResolutionPresets.map(preset => {
                    const width = isPortrait ? preset.height : preset.width;
                    const height = isPortrait ? preset.width : preset.height;
                    return { label: preset.label, value: `${width}x${height}` };
                  }),
                  { label: 'Custom…', value: 'custom' },
                ]}
                value={resolutionValue}
              />
            </div>
          </ExportInspectorRow>

          {video.useCustomResolution && (
            <ExportInspectorRow
              className={resolutionMatched ? 'is-composition-matched' : undefined}
              label="Custom Size"
            >
              <div className="export-inspector-number-pair">
                <input
                  aria-label="Custom width"
                  disabled={resolutionMatched}
                  max={7680}
                  min={1}
                  onChange={event => actions.setCustomWidth(Math.max(1, Number(event.target.value) || 1))}
                  type="number"
                  value={video.customWidth}
                />
                <span>×</span>
                <input
                  aria-label="Custom height"
                  disabled={resolutionMatched}
                  max={4320}
                  min={1}
                  onChange={event => actions.setCustomHeight(Math.max(1, Number(event.target.value) || 1))}
                  type="number"
                  value={video.customHeight}
                />
              </div>
            </ExportInspectorRow>
          )}

          <ExportInspectorRow
            actions={video.compositionMatchingAvailable ? (
              <ExportInspectorMatchCheckbox
                checked={video.matchCompositionFrameRate}
                label="Match composition frame rate"
                onChange={actions.setMatchCompositionFrameRate}
              />
            ) : undefined}
            className={frameRateMatched ? 'is-composition-matched' : undefined}
            label="Frame Rate"
            target="video-fps"
          >
            <InspectorSelect
              ariaLabel="Frame rate"
              disabled={frameRateMatched}
              onChange={value => {
                if (value === 'custom') {
                  actions.setUseCustomFps(true);
                } else {
                  actions.handleQuickFpsPreset(Number(value));
                }
              }}
              options={[
                ...options.quickFrameRatePresets.map(rate => ({ label: `${rate} fps`, value: String(rate) })),
                { label: 'Custom…', value: 'custom' },
              ]}
              value={frameRateValue}
            />
          </ExportInspectorRow>

          {video.useCustomFps && (
            <ExportInspectorRow
              className={frameRateMatched ? 'is-composition-matched' : undefined}
              label="Custom FPS"
            >
              <input
                disabled={frameRateMatched}
                max={240}
                min={1}
                onChange={event => actions.setCustomFps(Math.max(1, Math.min(240, Number(event.target.value) || 1)))}
                step={0.001}
                type="number"
                value={video.customFps}
              />
            </ExportInspectorRow>
          )}

          {mode.isGifMode ? (
            <>
              <ExportInspectorRow label="Colors" target="gif-palette">
                <input
                  max={256}
                  min={2}
                  onChange={event => actions.setGifColors(clampGifColors(Number(event.target.value)))}
                  type="number"
                  value={gif.gifColors}
                />
              </ExportInspectorRow>
              <ExportInspectorRow label="Palette">
                <InspectorSelect
                  ariaLabel="GIF palette"
                  onChange={value => actions.setGifPaletteMode(value as GifPaletteMode)}
                  options={GIF_PALETTE_MODES.map(option => ({ label: option.label, value: option.id }))}
                  value={gif.gifPaletteMode}
                />
              </ExportInspectorRow>
              <ExportInspectorRow label="Dither">
                <InspectorSelect
                  ariaLabel="GIF dither"
                  disabled={mode.isWebCodecsEncoder}
                  onChange={value => actions.setGifDither(value as GifDither)}
                  options={GIF_DITHER_OPTIONS.map(option => ({ label: option.label, value: option.id }))}
                  value={gif.gifDither}
                />
              </ExportInspectorRow>
              {!mode.isWebCodecsEncoder && gif.gifDither === 'bayer' && (
                <ExportInspectorRow label="Bayer Scale">
                  <input
                    max={5}
                    min={0}
                    onChange={event => actions.setGifBayerScale(clampGifBayerScale(Number(event.target.value)))}
                    type="number"
                    value={gif.gifBayerScale}
                  />
                </ExportInspectorRow>
              )}
              <ExportInspectorRow label="Loop">
                <InspectorSelect
                  ariaLabel="GIF loop"
                  onChange={value => actions.setGifLoop(value as ExportBasicsGifState['gifLoop'])}
                  options={[
                    { label: 'Forever', value: 'forever' },
                    { label: 'Once', value: 'once' },
                    { label: 'Count', value: 'count' },
                  ]}
                  value={gif.gifLoop}
                />
              </ExportInspectorRow>
              {gif.gifLoop === 'count' && (
                <ExportInspectorRow label="Loop Count">
                  <input
                    max={99}
                    min={2}
                    onChange={event => actions.setGifLoopCount(clampGifLoopCount(Number(event.target.value)))}
                    type="number"
                    value={gif.gifLoopCount}
                  />
                </ExportInspectorRow>
              )}
              <ExportInspectorRow label="Options">
                <div className="export-inspector-toggle-pair">
                  <ExportInspectorToggle checked={gif.gifTransparency} label="Transparent" onChange={actions.setGifTransparency} />
                  <ExportInspectorToggle checked={gif.gifOptimize} disabled={mode.isWebCodecsEncoder} label="Optimize" onChange={actions.setGifOptimize} />
                </div>
              </ExportInspectorRow>
              {gif.gifTransparency && (
                <ExportInspectorRow label="Alpha Threshold">
                  <input
                    max={255}
                    min={0}
                    onChange={event => actions.setGifAlphaThreshold(Number(event.target.value))}
                    type="number"
                    value={gif.gifAlphaThreshold}
                  />
                </ExportInspectorRow>
              )}
            </>
          ) : mode.isWebCodecsEncoder ? (
            <>
              <ExportInspectorRow label="Rate Control" target="video-rate">
                <InspectorSelect
                  ariaLabel="Rate control"
                  onChange={value => actions.setRateControl(value as 'vbr' | 'cbr')}
                  options={[
                    { label: 'VBR', value: 'vbr' },
                    { label: 'CBR', value: 'cbr' },
                  ]}
                  value={video.rateControl}
                />
              </ExportInspectorRow>
              <ExportInspectorRow label="Bitrate">
                <div className="export-inspector-slider-value">
                  <input
                    aria-label="Video bitrate"
                    max={100_000_000}
                    min={1_000_000}
                    onChange={event => actions.setBitrate(Number(event.target.value))}
                    step={500_000}
                    type="range"
                    value={video.bitrate}
                  />
                  <input
                    aria-label="Video bitrate in Mbps"
                    max={100}
                    min={1}
                    onChange={event => actions.setBitrate(Math.max(1, Number(event.target.value)) * 1_000_000)}
                    step={0.5}
                    type="number"
                    value={video.bitrate / 1_000_000}
                  />
                  <span>Mbps</span>
                </div>
              </ExportInspectorRow>
            </>
          ) : mode.showFFmpegQualityControl ? (
            <ExportInspectorRow label="Quality" target="video-rate">
              <div className="export-inspector-slider-value">
                <input
                  aria-label="MJPEG quality"
                  max={31}
                  min={1}
                  onChange={event => actions.setFfmpegQuality(Number(event.target.value))}
                  type="range"
                  value={video.ffmpegQuality}
                />
                <input
                  max={31}
                  min={1}
                  onChange={event => actions.setFfmpegQuality(Number(event.target.value))}
                  type="number"
                  value={video.ffmpegQuality}
                />
              </div>
            </ExportInspectorRow>
          ) : null}

          {!mode.isGifMode && (
            <ExportInspectorRow label="Alpha" target="video-alpha">
              <div className="export-inspector-toggle-pair">
                <ExportInspectorToggle
                  checked={mode.supportsNativeAlpha && video.includeAlpha}
                  disabled={!mode.supportsNativeAlpha}
                  label="Alpha Channel"
                  onChange={(enabled) => {
                    actions.setIncludeAlpha(enabled);
                    if (enabled) actions.setStackedAlpha(false);
                  }}
                />
                <ExportInspectorToggle
                  checked={video.stackedAlpha}
                  disabled={!mode.isWebCodecsEncoder}
                  label="Stacked Alpha"
                  onChange={(enabled) => {
                    actions.setStackedAlpha(enabled);
                    if (enabled) actions.setIncludeAlpha(false);
                  }}
                />
              </div>
            </ExportInspectorRow>
          )}

          {video.stackedAlpha && !mode.isGifMode && (
            <ExportInspectorNote tone="warning">
              Output becomes {video.actualWidth}×{video.actualHeight * 2}: RGB above, alpha below.
            </ExportInspectorNote>
          )}
          {(mode.encoder === 'ffmpeg' || mode.isGifMode) && display.ffmpegCodecInfo && (
            <ExportInspectorNote>{display.ffmpegCodecInfo.description}</ExportInspectorNote>
          )}
        </>
      )}
    </ExportInspectorSection>
  );
}

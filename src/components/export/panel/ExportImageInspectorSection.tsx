import type { BatchExportMediaType } from '../../../stores/exportStore';
import { ResolutionOrientationToggle } from '../../common/ResolutionOrientationToggle';
import type {
  ExportBasicsActions,
  ExportBasicsImageState,
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
} from './ExportInspectorPrimitives';

interface ExportImageInspectorSectionProps {
  actions: ExportBasicsActions;
  image: ExportBasicsImageState;
  mode: ExportBasicsModeState;
  options: ExportBasicsOptionState;
  sourceMediaType?: BatchExportMediaType;
  video: ExportBasicsVideoState;
}

export function ExportImageInspectorSection({
  actions,
  image,
  mode,
  options,
  sourceMediaType,
  video,
}: ExportImageInspectorSectionProps) {
  const isPortrait = video.actualHeight > video.actualWidth;
  const resolutionMatched = video.compositionMatchingAvailable && video.matchCompositionResolution;
  const frameRateMatched = video.compositionMatchingAvailable && video.matchCompositionFrameRate;
  const resolutionValue = video.useCustomResolution ? 'custom' : `${video.actualWidth}x${video.actualHeight}`;
  const frameRateValue = video.useCustomFps ? 'custom' : String(video.actualFps);

  const toggleResolutionOrientation = () => {
    if (video.useCustomResolution) {
      actions.setCustomWidth(video.actualHeight);
      actions.setCustomHeight(video.actualWidth);
      return;
    }
    actions.handleQuickResolutionPreset(`${video.actualHeight}x${video.actualWidth}`);
  };

  return (
    <ExportInspectorSection target="image-section" title="Image">
      {!sourceMediaType && (
        <ExportInspectorRow label="Mode" target="image-mode">
          <InspectorSelect
            ariaLabel="Image export mode"
            onChange={value => actions.setImageExportMode(value as ExportBasicsImageState['imageExportMode'])}
            options={[
              { label: 'Current frame', value: 'frame' },
              { label: 'Image sequence', value: 'sequence' },
            ]}
            value={image.imageExportMode}
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
        target="image-resolution"
      >
        <div className="export-inspector-inline">
          <ResolutionOrientationToggle
            disabled={resolutionMatched}
            height={video.actualHeight}
            onToggle={toggleResolutionOrientation}
            width={video.actualWidth}
          />
          <InspectorSelect
            ariaLabel="Image resolution"
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

      <ExportInspectorRow label="Quality" target="image-quality">
        {image.selectedImageFormat.lossless ? (
          <span className="export-inspector-static">Lossless</span>
        ) : (
          <div className="export-inspector-slider-value">
            <input
              aria-label="Image quality"
              max={1}
              min={0.4}
              onChange={event => actions.setImageQuality(Number(event.target.value))}
              step={0.01}
              type="range"
              value={image.imageQuality}
            />
            <input
              aria-label="Image quality percent"
              max={100}
              min={40}
              onChange={event => actions.setImageQuality(Number(event.target.value) / 100)}
              type="number"
              value={Math.round(image.imageQuality * 100)}
            />
            <span>%</span>
          </div>
        )}
      </ExportInspectorRow>

      {mode.isImageSequenceMode && (
        <>
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
            target="image-fps"
          >
            <InspectorSelect
              ariaLabel="Image frame rate"
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
        </>
      )}

      <ExportInspectorNote>
        {image.selectedImageFormat.supportsAlpha ? 'Transparency is preserved by this format.' : 'This format exports an opaque image.'}
      </ExportInspectorNote>
    </ExportInspectorSection>
  );
}

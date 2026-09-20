import {
  CLIP_SPEED_MAX_PERCENT,
  CLIP_SPEED_MIN_PERCENT,
} from '../../../../stores/timeline/helpers/linkedClipSpeed';
import { useTimelineStore } from '../../../../stores/timeline';
import { isVideoInspectorSectionEnabled } from '../../../../services/videoInspector/sectionBypass';
import type {
  ClipVideoInspectorSections,
  VideoInspectorSectionKey,
} from '../../../../types/timeline';
import { KeyframeToggle } from '../shared';
import { BLEND_MODE_GROUPS, formatBlendModeName } from '../sharedConstants';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import {
  ResolveInspectorIconButton,
  ResolveInspectorRow,
  ResolveInspectorSection,
  ResolveLinkIcon,
  ResolveResetIcon,
} from '../resolveInspector/ResolveInspectorPrimitives';
import type { CreateMidiTarget } from './transformTabTypes';
import { LabeledValue } from './ValueControls';
import { HandleOnlyRange } from './HandleOnlyRange';
import {
  buildResolveCropMaskPatch,
  isResolveCropMask,
  readResolveCropValues,
  RESOLVE_CROP_MASK_NAME,
  type ResolveCropValues,
} from './resolveCropMask';

interface ResolveVisualInspectorSectionsProps {
  blendMode: string;
  clipId: string;
  createMidiTarget: CreateMidiTarget;
  linkedAudioSpeedEnabled?: boolean;
  opacity: number;
  sections?: ClipVideoInspectorSections;
  sourceHeight: number;
  sourceWidth: number;
  speed: number;
  showTemporalSections?: boolean;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onBlendModeChange: (blendMode: string) => void;
  onLinkedAudioSpeedChange?: (enabled: boolean) => void;
  onOpacityChange: (percent: number) => void;
  onSectionEnabledChange: (section: VideoInspectorSectionKey, enabled: boolean) => void;
  onResetComposite: () => void;
  onResetSpeed: () => void;
  onSpeedChange: (percent: number) => void;
}

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ResolveInspectorIconButton
      ariaLabel={`Reset ${label}`}
      className="resolve-inspector-reset-button"
      onClick={onClick}
      title={`Reset ${label} to defaults and delete keyframes`}
    >
      <ResolveResetIcon />
    </ResolveInspectorIconButton>
  );
}

function PendingSectionBody({ children }: { children: string }) {
  return <p className="resolve-inspector-pending">{children}</p>;
}

export function ResolveVisualInspectorSections({
  blendMode,
  clipId,
  createMidiTarget,
  linkedAudioSpeedEnabled,
  opacity,
  sections,
  sourceHeight,
  sourceWidth,
  speed,
  showTemporalSections = true,
  onBatchEnd,
  onBatchStart,
  onBlendModeChange,
  onLinkedAudioSpeedChange,
  onOpacityChange,
  onSectionEnabledChange,
  onResetComposite,
  onResetSpeed,
  onSpeedChange,
}: ResolveVisualInspectorSectionsProps) {
  const cropMask = useTimelineStore(state => state.clips
    .find(clip => clip.id === clipId)
    ?.masks?.find(isResolveCropMask));
  const addMask = useTimelineStore(state => state.addMask);
  const updateMask = useTimelineStore(state => state.updateMask);
  const removeMask = useTimelineStore(state => state.removeMask);
  const hasStabilization = useTimelineStore(state => state.clipKeyframes?.get(clipId)?.some(key => key.id.startsWith('face-stabilize:')) ?? false);
  const opacityPercent = opacity * 100;
  const speedPercent = speed * 100;
  const cropSectionEnabled = isVideoInspectorSectionEnabled(sections, 'cropping');
  const croppingEnabled = cropSectionEnabled && (cropMask?.enabled !== false);
  const cropValues = readResolveCropValues(cropMask, sourceWidth, sourceHeight);

  const updateCropValue = (key: keyof ResolveCropValues, value: number) => {
    let maskId = cropMask?.id;
    if (!maskId) {
      maskId = addMask(clipId, {
        name: RESOLVE_CROP_MASK_NAME,
        purpose: 'crop',
        mode: 'intersect',
        closed: true,
        enabled: cropSectionEnabled,
        visible: false,
      });
    }
    updateMask(clipId, maskId, {
      ...buildResolveCropMaskPatch(
        maskId,
        { ...cropValues, [key]: value },
        sourceWidth,
        sourceHeight,
      ),
      enabled: cropSectionEnabled,
    });
  };

  const handleCroppingEnabledChange = (enabled: boolean) => {
    onSectionEnabledChange('cropping', enabled);
    if (cropMask) updateMask(clipId, cropMask.id, { enabled });
  };

  const resetCropping = () => {
    if (!cropMask) return;
    onBatchStart();
    try {
      removeMask(clipId, cropMask.id);
    } finally {
      onBatchEnd();
    }
  };

  const croppingSection = (
    <ResolveInspectorSection
      defaultOpen={false}
      enabled={croppingEnabled}
      headerActions={<ResetButton label="cropping" onClick={resetCropping} />}
      onEnabledChange={handleCroppingEnabledChange}
      title="Cropping"
    >
      {([
        ['left', 'Crop Left', sourceWidth],
        ['right', 'Crop Right', sourceWidth],
        ['top', 'Crop Top', sourceHeight],
        ['bottom', 'Crop Bottom', sourceHeight],
        ['softness', 'Softness', Math.max(sourceWidth, sourceHeight) / 2],
      ] as const).map(([key, label, max]) => (
        <ResolveInspectorRow key={key} label={label}>
          <div className="resolve-inspector-slider-value">
            <HandleOnlyRange
              aria-label={`${label} slider`}
              max={max}
              min={0}
              onChange={value => updateCropValue(key, value)}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              step={0.1}
              value={cropValues[key]}
            />
            <LabeledValue
              ariaLabel={label}
              className="resolve-inspector-field resolve-inspector-field--plain"
              decimals={3}
              defaultValue={0}
              label=""
              max={max}
              min={0}
              onChange={value => updateCropValue(key, value)}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              sensitivity={1}
              value={cropValues[key]}
            />
          </div>
        </ResolveInspectorRow>
      ))}
      <ResolveInspectorRow label="">
        <label className="resolve-inspector-crop-retain-position">
          <input checked readOnly type="checkbox" />
          <span>Retain Image Position</span>
        </label>
      </ResolveInspectorRow>
    </ResolveInspectorSection>
  );

  return (
    <div className="resolve-visual-inspector-sections">
      <ResolveInspectorSection
        enabled={isVideoInspectorSectionEnabled(sections, 'composite')}
        headerActions={(
          <>
            <KeyframeToggle clipId={clipId} property="opacity" value={opacity} />
            <ResetButton label="composite" onClick={onResetComposite} />
          </>
        )}
        onEnabledChange={enabled => onSectionEnabledChange('composite', enabled)}
        title="Composite"
      >
        <ResolveInspectorRow label="Composite Mode">
          <InspectorSelect
            ariaLabel="Composite Mode"
            groups={BLEND_MODE_GROUPS.map(group => ({
              label: group.label,
              options: group.modes.map(mode => ({
                label: formatBlendModeName(mode),
                value: mode,
              })),
            }))}
            onChange={onBlendModeChange}
            touchScrollSelection
            value={blendMode}
            wheelSelection
          />
        </ResolveInspectorRow>
        <ResolveInspectorRow
          actions={<KeyframeToggle clipId={clipId} property="opacity" value={opacity} />}
          label="Opacity"
        >
          <div className="resolve-inspector-slider-value">
            <HandleOnlyRange
              aria-label="Opacity slider"
              max={100}
              min={0}
              onChange={onOpacityChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              step={0.1}
              value={opacityPercent}
            />
            <LabeledValue
              ariaLabel="Opacity"
              className="resolve-inspector-field resolve-inspector-field--plain"
              decimals={2}
              defaultValue={100}
              label=""
              max={100}
              midiTarget={createMidiTarget('opacity', 'Opacity', opacity, 0, 1)}
              min={0}
              onChange={onOpacityChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              sensitivity={0.5}
              suffix="%"
              value={opacityPercent}
            />
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      {showTemporalSections && (
        <ResolveInspectorSection
          defaultOpen={false}
          enabled={isVideoInspectorSectionEnabled(sections, 'speedChange')}
          headerActions={(
            <>
              <KeyframeToggle clipId={clipId} property="speed" value={speed} />
              <ResetButton label="speed" onClick={onResetSpeed} />
            </>
          )}
          onEnabledChange={enabled => onSectionEnabledChange('speedChange', enabled)}
          title="Speed Change"
        >
          <ResolveInspectorRow
            actions={<KeyframeToggle clipId={clipId} property="speed" value={speed} />}
            label="Speed"
          >
            <div className="resolve-inspector-speed-value">
              <LabeledValue
                ariaLabel="Speed"
                className="resolve-inspector-field resolve-inspector-field--plain"
                decimals={0}
                defaultValue={100}
                label=""
                max={CLIP_SPEED_MAX_PERCENT}
                midiTarget={createMidiTarget('speed', 'Speed', speed, -10, 10)}
                min={CLIP_SPEED_MIN_PERCENT}
                onChange={onSpeedChange}
                onDragEnd={onBatchEnd}
                onDragStart={onBatchStart}
                sensitivity={1}
                suffix="%"
                value={speedPercent}
              />
              {linkedAudioSpeedEnabled !== undefined && onLinkedAudioSpeedChange && (
                <ResolveInspectorIconButton
                  active={linkedAudioSpeedEnabled}
                  ariaLabel="Linked Audio"
                  onClick={() => onLinkedAudioSpeedChange(!linkedAudioSpeedEnabled)}
                >
                  <ResolveLinkIcon />
                </ResolveInspectorIconButton>
              )}
            </div>
          </ResolveInspectorRow>
        </ResolveInspectorSection>
      )}

      {croppingSection}

      {showTemporalSections && (
        <ResolveInspectorSection
          collapsible={hasStabilization}
          defaultOpen={false}
          enabled={hasStabilization && isVideoInspectorSectionEnabled(sections, 'stabilization')}
          onEnabledChange={hasStabilization ? enabled => onSectionEnabledChange('stabilization', enabled) : undefined}
          title="Stabilization"
        >
          <PendingSectionBody>{hasStabilization
            ? 'Bypass baked face/lip stabilization while keeping its keyframes, zoom and manual transforms.'
            : 'Use Tracking > Stabilize face or Stabilize lips first.'}</PendingSectionBody>
        </ResolveInspectorSection>
      )}
    </div>
  );
}

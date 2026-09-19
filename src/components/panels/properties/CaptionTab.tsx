import { useEffect, useMemo } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type {
  CaptionClipProperties,
  CaptionHighlightMode,
  CaptionHighlightStyle,
  CaptionTextTransform,
} from '../../../types/caption';
import type { CaptionPropertiesPatch } from '../../../stores/timeline/types';
import { DEFAULT_TEXT_PROPERTIES } from '../../../stores/timeline/constants';
import {
  DEFAULT_CAPTION_PROPERTIES,
  createCaptionTextProperties,
} from '../../../services/captions/captionDefaults';
import { TextTab } from '../TextTab';
import { LabeledValue } from './transformTab/ValueControls';
import {
  PROPERTY_VALUE_RESET_TITLE,
  resetPropertyValueOnContextMenu,
} from './propertyValueReset';
import {
  PropertyPillSelect,
  type PropertyPillOption,
} from './PropertyPillSelect';
import { CaptionTranscriptPanel } from './CaptionTranscriptPanel';

interface CaptionTabProps {
  clipId: string;
  properties: CaptionClipProperties;
}

const TEXT_TRANSFORM_OPTIONS: readonly PropertyPillOption<CaptionTextTransform>[] = [
  { value: 'none', label: 'Original', title: 'As transcribed' },
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'lowercase', label: 'lowercase' },
  { value: 'capitalize', label: 'Capitalize' },
];

const HIGHLIGHT_MODE_OPTIONS: readonly PropertyPillOption<CaptionHighlightMode>[] = [
  { value: 'active-word', label: 'Current', title: 'Current word' },
  { value: 'spoken-words', label: 'Spoken', title: 'Spoken words' },
  { value: 'caption-group', label: 'Whole', title: 'Whole caption' },
];

const HIGHLIGHT_STYLE_OPTIONS: readonly PropertyPillOption<CaptionHighlightStyle>[] = [
  { value: 'text', label: 'Color', title: 'Text color' },
  { value: 'background', label: 'Background', title: 'Word background' },
  { value: 'underline', label: 'Underline' },
];

function NumberValue({
  label,
  value,
  onChange,
  min,
  max,
  decimals = 0,
  suffix = '',
  defaultValue,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  decimals?: number;
  suffix?: string;
  defaultValue?: number;
}) {
  return (
    <LabeledValue
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      decimals={decimals}
      suffix={suffix}
      defaultValue={defaultValue}
    />
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  defaultValue,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  defaultValue: boolean;
}) {
  return (
    <div className="control-row transform-option-row">
      <label className="prop-label">{label}</label>
      <button
        type="button"
        className={`btn btn-xs ${checked ? 'btn-active' : ''}`}
        onClick={() => onChange(!checked)}
        onContextMenu={(event) => resetPropertyValueOnContextMenu(
          event,
          () => onChange(defaultValue),
        )}
        title={PROPERTY_VALUE_RESET_TITLE}
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  defaultValue,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultValue: string;
}) {
  return (
    <div className="control-row">
      <label className="prop-label">{label}</label>
      <input
        type="color"
        value={value.startsWith('#') ? value.slice(0, 7) : '#ffffff'}
        onChange={event => onChange(event.target.value)}
        onContextMenu={(event) => resetPropertyValueOnContextMenu(
          event,
          () => onChange(defaultValue),
        )}
        title={PROPERTY_VALUE_RESET_TITLE}
        style={{ width: 28, height: 22, padding: 0 }}
      />
      <input
        type="text"
        className="caption-color-value"
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-label={`${label} value`}
        onContextMenu={(event) => resetPropertyValueOnContextMenu(
          event,
          () => onChange(defaultValue),
        )}
        title={PROPERTY_VALUE_RESET_TITLE}
      />
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  decimals = 0,
  suffix = '',
  defaultValue,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  decimals?: number;
  suffix?: string;
  defaultValue?: number;
}) {
  return (
    <div className="control-row caption-number-row">
      <div className="multi-value-row">
        <NumberValue label={label} value={value} onChange={onChange} min={min} max={max} decimals={decimals} suffix={suffix} defaultValue={defaultValue} />
      </div>
    </div>
  );
}

export function CaptionTab({ clipId, properties }: CaptionTabProps) {
  const clips = useTimelineStore(state => state.clips);
  const updateCaptionProperties = useTimelineStore(state => state.updateCaptionProperties);
  const ensureCaptionTextClip = useTimelineStore(state => state.ensureCaptionTextClip);
  const clip = clips.find(candidate => candidate.id === clipId);
  const captionTextCanvasSize = {
    width: clip?.source?.textCanvas?.width ?? 1920,
    height: clip?.source?.textCanvas?.height ?? 1080,
  };
  const captionTextResetDefaults = useMemo(() => createCaptionTextProperties({
    caption: DEFAULT_CAPTION_PROPERTIES,
    base: DEFAULT_TEXT_PROPERTIES,
    width: captionTextCanvasSize.width,
    height: captionTextCanvasSize.height,
  }), [captionTextCanvasSize.height, captionTextCanvasSize.width]);
  const update = (patch: CaptionPropertiesPatch) => updateCaptionProperties(clipId, patch);

  useEffect(() => {
    void ensureCaptionTextClip(clipId);
  }, [clipId, ensureCaptionTextClip]);

  return (
    <div className="properties-tab-content transform-tab-compact" aria-label="Caption clip properties">
      <CaptionTranscriptPanel captionClipId={clipId} />

      <div className="properties-section">
        <h4>Caption layout</h4>
        <div className="control-row">
          <label className="prop-label">Timing</label>
          <div className="multi-value-row">
            <NumberValue label="Words" value={properties.wordsPerCaption} onChange={value => update({ wordsPerCaption: Math.round(value) })} min={1} max={20} defaultValue={DEFAULT_CAPTION_PROPERTIES.wordsPerCaption} />
            <NumberValue label="Gap" value={properties.gapThreshold} onChange={gapThreshold => update({ gapThreshold })} min={0} max={5} decimals={2} suffix="s" defaultValue={DEFAULT_CAPTION_PROPERTIES.gapThreshold} />
            <NumberValue label="Hold" value={properties.holdAfter} onChange={holdAfter => update({ holdAfter })} min={0} max={3} decimals={2} suffix="s" defaultValue={DEFAULT_CAPTION_PROPERTIES.holdAfter} />
          </div>
        </div>
        <NumberRow label="Lines" value={properties.maxLines} onChange={value => update({ maxLines: Math.round(value) })} min={1} max={10} defaultValue={DEFAULT_CAPTION_PROPERTIES.maxLines} />
        <div className="control-row caption-choice-row">
          <label className="prop-label">Case</label>
          <PropertyPillSelect
            ariaLabel="Caption case"
            value={properties.textTransform}
            onChange={textTransform => update({ textTransform })}
            onReset={() => update({ textTransform: DEFAULT_CAPTION_PROPERTIES.textTransform })}
            options={TEXT_TRANSFORM_OPTIONS}
          />
        </div>
        <p className="properties-hint">Lines sets the visible line limit. Wrapping and position use the Text section's Area Text bounds.</p>
      </div>

      {clip?.source?.type === 'text' && clip.textProperties && (
        <div className="properties-section">
          <TextTab
            clipId={clipId}
            textProperties={clip.textProperties}
            liveText
            hideContent
            compact
            canvasSize={captionTextCanvasSize}
            resetDefaults={captionTextResetDefaults}
            selectionPills
          />
        </div>
      )}

      <div className="properties-section">
        <h4>Caption background</h4>
        <ToggleRow label="Enabled" checked={properties.background.enabled} onChange={enabled => update({ background: { enabled } })} defaultValue={DEFAULT_CAPTION_PROPERTIES.background.enabled} />
        {properties.background.enabled && (
          <>
            <ColorRow label="Color" value={properties.background.color} onChange={color => update({ background: { color } })} defaultValue={DEFAULT_CAPTION_PROPERTIES.background.color} />
            <div className="control-row">
              <label className="prop-label">Box</label>
              <div className="multi-value-row">
                <NumberValue label="Opacity" value={properties.background.opacity * 100} onChange={value => update({ background: { opacity: value / 100 } })} min={0} max={100} suffix="%" defaultValue={DEFAULT_CAPTION_PROPERTIES.background.opacity * 100} />
                <NumberValue label="Pad X" value={properties.background.paddingX} onChange={paddingX => update({ background: { paddingX } })} min={0} max={200} suffix="px" defaultValue={DEFAULT_CAPTION_PROPERTIES.background.paddingX} />
                <NumberValue label="Pad Y" value={properties.background.paddingY} onChange={paddingY => update({ background: { paddingY } })} min={0} max={200} suffix="px" defaultValue={DEFAULT_CAPTION_PROPERTIES.background.paddingY} />
                <NumberValue label="Radius" value={properties.background.borderRadius} onChange={borderRadius => update({ background: { borderRadius } })} min={0} max={200} suffix="px" defaultValue={DEFAULT_CAPTION_PROPERTIES.background.borderRadius} />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="properties-section">
        <h4>Word highlight</h4>
        <ToggleRow label="Enabled" checked={properties.highlight.enabled} onChange={enabled => update({ highlight: { enabled } })} defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.enabled} />
        {properties.highlight.enabled && (
          <>
            <div className="control-row caption-choice-row">
              <label className="prop-label">Timing</label>
              <PropertyPillSelect
                ariaLabel="Word highlight timing"
                value={properties.highlight.mode}
                onChange={mode => update({ highlight: { mode } })}
                onReset={() => update({ highlight: { mode: DEFAULT_CAPTION_PROPERTIES.highlight.mode } })}
                options={HIGHLIGHT_MODE_OPTIONS}
              />
            </div>
            <div className="control-row caption-choice-row">
              <label className="prop-label">Style</label>
              <PropertyPillSelect
                ariaLabel="Word highlight style"
                value={properties.highlight.style}
                onChange={style => update({ highlight: { style } })}
                onReset={() => update({ highlight: { style: DEFAULT_CAPTION_PROPERTIES.highlight.style } })}
                options={HIGHLIGHT_STYLE_OPTIONS}
              />
            </div>
            {properties.highlight.style === 'text' && <ColorRow label="Color" value={properties.highlight.textColor} onChange={textColor => update({ highlight: { textColor } })} defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.textColor} />}
            {properties.highlight.style === 'background' && (
              <>
                <ColorRow label="Color" value={properties.highlight.backgroundColor} onChange={backgroundColor => update({ highlight: { backgroundColor } })} defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.backgroundColor} />
                <NumberRow label="Opacity" value={properties.highlight.backgroundOpacity * 100} onChange={value => update({ highlight: { backgroundOpacity: value / 100 } })} min={0} max={100} suffix="%" defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.backgroundOpacity * 100} />
              </>
            )}
            {properties.highlight.style === 'underline' && (
              <>
                <ColorRow label="Color" value={properties.highlight.underlineColor} onChange={underlineColor => update({ highlight: { underlineColor } })} defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.underlineColor} />
                <NumberRow label="Width" value={properties.highlight.underlineWidth} onChange={underlineWidth => update({ highlight: { underlineWidth } })} min={1} max={30} suffix="px" defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.underlineWidth} />
              </>
            )}
            <ToggleRow label="Scale" checked={properties.highlight.scaleEnabled ?? false} onChange={scaleEnabled => update({ highlight: { scaleEnabled } })} defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.scaleEnabled} />
            {(properties.highlight.scaleEnabled ?? false) && (
              <NumberRow label="Peak" value={(properties.highlight.scale ?? DEFAULT_CAPTION_PROPERTIES.highlight.scale) * 100} onChange={value => update({ highlight: { scale: value / 100 } })} min={100} max={300} decimals={0} suffix="%" defaultValue={DEFAULT_CAPTION_PROPERTIES.highlight.scale * 100} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo } from 'react';
import { getCaptionSourceCandidates } from '../../../services/captions/captionRuntime';
import { useTimelineStore } from '../../../stores/timeline';
import type {
  CaptionClipProperties,
  CaptionHighlightMode,
  CaptionHighlightStyle,
  CaptionTextTransform,
} from '../../../types/caption';
import type { CaptionPropertiesPatch } from '../../../stores/timeline/types';
import { TextTab } from '../TextTab';
import { LabeledValue } from './transformTab/ValueControls';

interface CaptionTabProps {
  clipId: string;
  properties: CaptionClipProperties;
}

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
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="control-row transform-option-row">
      <label className="prop-label">{label}</label>
      <button
        type="button"
        className={`btn btn-xs ${checked ? 'btn-active' : ''}`}
        onClick={() => onChange(!checked)}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="control-row">
      <label className="prop-label">{label}</label>
      <input
        type="color"
        value={value.startsWith('#') ? value.slice(0, 7) : '#ffffff'}
        onChange={event => onChange(event.target.value)}
        style={{ width: 28, height: 22, padding: 0 }}
      />
      <input
        type="text"
        className="caption-color-value"
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-label={`${label} value`}
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
  const tracks = useTimelineStore(state => state.tracks);
  const updateCaptionProperties = useTimelineStore(state => state.updateCaptionProperties);
  const ensureCaptionTextClip = useTimelineStore(state => state.ensureCaptionTextClip);
  const clip = clips.find(candidate => candidate.id === clipId);
  const sources = useMemo(
    () => getCaptionSourceCandidates(clips, clipId),
    [clipId, clips],
  );
  const sourceIds = new Set(sources.map(source => source.clip.id));
  const sourceValue = properties.sourceClipId && sourceIds.has(properties.sourceClipId)
    ? properties.sourceClipId
    : 'auto';
  const update = (patch: CaptionPropertiesPatch) => updateCaptionProperties(clipId, patch);

  useEffect(() => {
    void ensureCaptionTextClip(clipId);
  }, [clipId, ensureCaptionTextClip]);

  return (
    <div className="properties-tab-content transform-tab-compact" aria-label="Caption clip properties">
      <div className="properties-section">
        <h4>Transcript source</h4>
        <div className="control-row">
          <label className="prop-label">Source</label>
          <select
            className="caption-compact-select caption-source-select"
            value={sourceValue}
            onChange={event => update({
              sourceClipId: event.target.value === 'auto' ? null : event.target.value,
            })}
          >
            <option value="auto">Auto - active transcript</option>
            {sources.map(({ clip: sourceClip }) => {
              const track = tracks.find(candidate => candidate.id === sourceClip.trackId);
              return (
                <option key={sourceClip.id} value={sourceClip.id}>
                  {sourceClip.name} - {track?.name ?? 'Timeline'} - {sourceClip.startTime.toFixed(1)}s
                </option>
              );
            })}
          </select>
        </div>
        {properties.sourceClipId && !sourceIds.has(properties.sourceClipId) && (
          <p className="properties-hint">The selected source is missing. Auto source is used.</p>
        )}
        {sources.length === 0 && (
          <p className="properties-hint">No transcript is available yet.</p>
        )}
      </div>

      <div className="properties-section">
        <h4>Caption layout</h4>
        <div className="control-row">
          <label className="prop-label">Timing</label>
          <div className="multi-value-row">
            <NumberValue label="Words" value={properties.wordsPerCaption} onChange={value => update({ wordsPerCaption: Math.round(value) })} min={1} max={20} defaultValue={5} />
            <NumberValue label="Gap" value={properties.gapThreshold} onChange={gapThreshold => update({ gapThreshold })} min={0} max={5} decimals={2} suffix="s" defaultValue={0.8} />
            <NumberValue label="Hold" value={properties.holdAfter} onChange={holdAfter => update({ holdAfter })} min={0} max={3} decimals={2} suffix="s" defaultValue={0.2} />
          </div>
        </div>
        <div className="control-row">
          <label className="prop-label">Case</label>
          <select
            className="caption-compact-select"
            value={properties.textTransform}
            onChange={event => update({ textTransform: event.target.value as CaptionTextTransform })}
          >
            <option value="none">As transcribed</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="lowercase">lowercase</option>
            <option value="capitalize">Capitalize</option>
          </select>
        </div>
        <p className="properties-hint">Line wrapping and position use the Text section's Area Text bounds.</p>
      </div>

      {clip?.source?.type === 'text' && clip.textProperties && (
        <div className="properties-section">
          <TextTab
            clipId={clipId}
            textProperties={clip.textProperties}
            liveText
            hideContent
            compact
            canvasSize={{
              width: clip.source.textCanvas?.width ?? 1920,
              height: clip.source.textCanvas?.height ?? 1080,
            }}
          />
        </div>
      )}

      <div className="properties-section">
        <h4>Caption background</h4>
        <ToggleRow label="Enabled" checked={properties.background.enabled} onChange={enabled => update({ background: { enabled } })} />
        {properties.background.enabled && (
          <>
            <ColorRow label="Color" value={properties.background.color} onChange={color => update({ background: { color } })} />
            <div className="control-row">
              <label className="prop-label">Box</label>
              <div className="multi-value-row">
                <NumberValue label="Opacity" value={properties.background.opacity * 100} onChange={value => update({ background: { opacity: value / 100 } })} min={0} max={100} suffix="%" defaultValue={70} />
                <NumberValue label="Pad X" value={properties.background.paddingX} onChange={paddingX => update({ background: { paddingX } })} min={0} max={200} suffix="px" defaultValue={26} />
                <NumberValue label="Pad Y" value={properties.background.paddingY} onChange={paddingY => update({ background: { paddingY } })} min={0} max={200} suffix="px" defaultValue={14} />
                <NumberValue label="Radius" value={properties.background.borderRadius} onChange={borderRadius => update({ background: { borderRadius } })} min={0} max={200} suffix="px" defaultValue={16} />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="properties-section">
        <h4>Word highlight</h4>
        <ToggleRow label="Enabled" checked={properties.highlight.enabled} onChange={enabled => update({ highlight: { enabled } })} />
        {properties.highlight.enabled && (
          <>
            <div className="control-row">
              <label className="prop-label">Timing</label>
              <select className="caption-compact-select" value={properties.highlight.mode} onChange={event => update({ highlight: { mode: event.target.value as CaptionHighlightMode } })}>
                <option value="active-word">Current word</option>
                <option value="spoken-words">Spoken words</option>
                <option value="caption-group">Whole caption</option>
              </select>
            </div>
            <div className="control-row">
              <label className="prop-label">Style</label>
              <select className="caption-compact-select" value={properties.highlight.style} onChange={event => update({ highlight: { style: event.target.value as CaptionHighlightStyle } })}>
                <option value="text">Text color</option>
                <option value="background">Word background</option>
                <option value="underline">Underline</option>
              </select>
            </div>
            {properties.highlight.style === 'text' && <ColorRow label="Color" value={properties.highlight.textColor} onChange={textColor => update({ highlight: { textColor } })} />}
            {properties.highlight.style === 'background' && (
              <>
                <ColorRow label="Color" value={properties.highlight.backgroundColor} onChange={backgroundColor => update({ highlight: { backgroundColor } })} />
                <NumberRow label="Opacity" value={properties.highlight.backgroundOpacity * 100} onChange={value => update({ highlight: { backgroundOpacity: value / 100 } })} min={0} max={100} suffix="%" defaultValue={95} />
              </>
            )}
            {properties.highlight.style === 'underline' && (
              <>
                <ColorRow label="Color" value={properties.highlight.underlineColor} onChange={underlineColor => update({ highlight: { underlineColor } })} />
                <NumberRow label="Width" value={properties.highlight.underlineWidth} onChange={underlineWidth => update({ highlight: { underlineWidth } })} min={1} max={30} suffix="px" defaultValue={6} />
              </>
            )}
            <ToggleRow label="Scale" checked={properties.highlight.scaleEnabled ?? false} onChange={scaleEnabled => update({ highlight: { scaleEnabled } })} />
            {(properties.highlight.scaleEnabled ?? false) && (
              <NumberRow label="Peak" value={(properties.highlight.scale ?? 1.18) * 100} onChange={value => update({ highlight: { scale: value / 100 } })} min={100} max={300} decimals={0} suffix="%" defaultValue={118} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

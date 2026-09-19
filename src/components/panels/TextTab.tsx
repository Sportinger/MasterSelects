/**
 * Text Tab Component - Compact typography controls for text clips
 * Inspired by After Effects / professional NLE text panels
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { createTextBoundsPathProperty } from '../../types/animationProperties';
import type { Keyframe } from '../../types/keyframes';
import type { TextClipProperties } from '../../types/text';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TEXT_PROPERTIES } from '../../stores/timeline/constants';
import { googleFontsService, POPULAR_FONTS } from '../../services/googleFontsService';
import { LabeledValue } from './properties/transformTab/ValueControls';
import {
  PROPERTY_VALUE_RESET_TITLE,
  resetPropertyValueOnContextMenu,
} from './properties/propertyValueReset';
import { ALL_FONT_WEIGHTS, getFontWeightLabel } from './properties/fontWeightOptions';
import { InspectorSelect } from '../inspector/InspectorSelect';
import {
  ResolveInspectorRow,
  ResolveInspectorSection,
} from './properties/resolveInspector/ResolveInspectorPrimitives';
import {
  createTextBoundsFromRect,
  getTextBoundsPathValue,
  resolveTextBoundsPath,
  resolveTextBoxRect,
} from '../../services/textLayout';

const EMPTY_KEYFRAMES: Keyframe[] = [];

function getTextValueLabel(title: string): string {
  const labels: Record<string, string> = {
    'Font Size': 'Size',
    'Line Height': 'Line',
    'Letter Spacing': 'Track',
    'Stroke Width': 'Width',
    'Box X': 'X',
    'Box Y': 'Y',
    'Box Width': 'W',
    'Box Height': 'H',
    'Shadow Offset X': 'X',
    'Shadow Offset Y': 'Y',
    'Shadow Blur': 'Blur',
  };
  return labels[title] ?? title;
}

interface TextValueProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  title: string;
  defaultValue?: number;
}

function TextValue({ value, onChange, min = 0, max = 999, step = 1, unit = 'px', title, defaultValue }: TextValueProps) {
  return (
    <LabeledValue
      ariaLabel={title}
      className="resolve-inspector-field"
      label={getTextValueLabel(title)}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      decimals={step < 1 ? 1 : 0}
      suffix={unit}
      defaultValue={defaultValue}
    />
  );
}

// SVG Icons as inline components
const IconStraightenBounds = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.3" fill="none">
    <path d="M2 3h10v8H2z" />
    <path d="M4 5h6M4 7h5M4 9h4" />
  </svg>
);

const IconAlignLeft = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" fill="none">
    <path d="M1 2h12M1 5h8M1 8h10M1 11h6"/>
  </svg>
);

const IconAlignCenter = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" fill="none">
    <path d="M1 2h12M3 5h8M2 8h10M4 11h6"/>
  </svg>
);

const IconAlignRight = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" fill="none">
    <path d="M1 2h12M5 5h8M3 8h10M7 11h6"/>
  </svg>
);

const IconAlignTop = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" fill="none">
    <path d="M2 1h10M7 4v9M5 6l2-2 2 2"/>
  </svg>
);

const IconAlignMiddle = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" fill="none">
    <path d="M2 7h10M7 3v8M5 5l2-2 2 2M5 9l2 2 2-2"/>
  </svg>
);

const IconAlignBottom = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" fill="none">
    <path d="M2 13h10M7 1v9M5 8l2 2 2-2"/>
  </svg>
);

function StopwatchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="13" r="7" />
      <line x1="12" y1="13" x2="12" y2="9" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  );
}

function TextBoundsPathKeyframeToggle({
  clipId,
  textProperties,
  canvasSize,
}: {
  clipId: string;
  textProperties: TextClipProperties;
  canvasSize: { width: number; height: number };
}) {
  const property = createTextBoundsPathProperty();
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYFRAMES);
  const recordingEnabled = useTimelineStore(state => state.keyframeRecordingEnabled.has(`${clipId}:${property}`));
  const hasPathKeyframes = clipKeyframes.some(keyframe => keyframe.property === property);
  const { addTextBoundsPathKeyframe, toggleKeyframeRecording, disableTextBoundsPathKeyframes } = useTimelineStore.getState();

  const addPathKeyframe = useCallback(() => {
    const bounds = resolveTextBoundsPath(textProperties, canvasSize.width, canvasSize.height);
    const pathValue = getTextBoundsPathValue(bounds);
    addTextBoundsPathKeyframe(clipId, pathValue);
    if (!recordingEnabled && !hasPathKeyframes) {
      toggleKeyframeRecording(clipId, property);
    }
  }, [
    addTextBoundsPathKeyframe,
    canvasSize.height,
    canvasSize.width,
    clipId,
    hasPathKeyframes,
    property,
    recordingEnabled,
    textProperties,
    toggleKeyframeRecording,
  ]);

  return (
    <button
      type="button"
      className={`keyframe-toggle ${recordingEnabled ? 'recording' : ''} ${hasPathKeyframes ? 'has-keyframes' : ''}`}
      title={recordingEnabled || hasPathKeyframes ? 'Add Text Bounds keyframe (right-click to disable)' : 'Add Text Bounds keyframe'}
      onClick={(event) => {
        event.stopPropagation();
        addPathKeyframe();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const bounds = resolveTextBoundsPath(textProperties, canvasSize.width, canvasSize.height);
        disableTextBoundsPathKeyframes(clipId, getTextBoundsPathValue(bounds));
      }}
    >
      <StopwatchIcon />
    </button>
  );
}

interface TextTabProps {
  clipId: string;
  textProperties: TextClipProperties;
  canvasSize?: { width: number; height: number };
  liveText?: boolean;
  hideContent?: boolean;
  compact?: boolean;
  resetDefaults?: Partial<TextClipProperties>;
  selectionPills?: boolean;
}

export function TextTab({
  clipId,
  textProperties,
  canvasSize = { width: 1920, height: 1080 },
  liveText = false,
  hideContent = false,
  compact = false,
  resetDefaults,
  selectionPills = false,
}: TextTabProps) {
  const { updateTextProperties } = useTimelineStore();
  const [localText, setLocalText] = useState(textProperties.text);

  // Sync local text with props
  useEffect(() => {
    queueMicrotask(() => setLocalText(textProperties.text));
  }, [textProperties.text]);

  // Debounced text update - 50ms for near-instant preview
  useEffect(() => {
    if (liveText) return;
    const timer = setTimeout(() => {
      if (localText !== textProperties.text) {
        updateTextProperties(clipId, { text: localText });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [liveText, localText, clipId, textProperties.text, updateTextProperties]);

  // Load font when component mounts
  useEffect(() => {
    googleFontsService.loadFont(textProperties.fontFamily, textProperties.fontWeight);
  }, [textProperties.fontFamily, textProperties.fontWeight]);

  useEffect(() => {
    if (!selectionPills) return;
    void googleFontsService.preloadFont(textProperties.fontFamily);
  }, [selectionPills, textProperties.fontFamily]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalText(e.target.value);
  }, []);

  const updateProp = useCallback(<K extends keyof TextClipProperties>(
    key: K,
    value: TextClipProperties[K]
  ) => {
    updateTextProperties(clipId, { [key]: value } as Partial<TextClipProperties>);
  }, [clipId, updateTextProperties]);

  // Get available weights for selected font
  const availableWeights = googleFontsService.getAvailableWeights(textProperties.fontFamily);
  const canvasWidth = Math.max(1, Math.round(canvasSize.width));
  const canvasHeight = Math.max(1, Math.round(canvasSize.height));
  const defaultProperties = useMemo<TextClipProperties>(() => ({
    ...DEFAULT_TEXT_PROPERTIES,
    boxX: 0,
    boxY: 0,
    boxWidth: canvasWidth,
    boxHeight: canvasHeight,
    ...resetDefaults,
  }), [canvasHeight, canvasWidth, resetDefaults]);
  const textBox = resolveTextBoxRect(textProperties, canvasWidth, canvasHeight);
  const boxEnabled = textProperties.boxEnabled === true;

  const updateTextBoxEnabled = useCallback((enabled: boolean) => {
    if (!enabled) {
      updateTextProperties(clipId, { boxEnabled: false });
      return;
    }

    const box = resolveTextBoxRect(textProperties, canvasWidth, canvasHeight);
    updateTextProperties(clipId, {
      boxEnabled: true,
      boxX: Math.round(box.x),
      boxY: Math.round(box.y),
      boxWidth: Math.round(box.width),
      boxHeight: Math.round(box.height),
      textBounds: createTextBoundsFromRect(box, canvasWidth, canvasHeight, undefined, { clampToCanvas: false }),
    });
  }, [canvasHeight, canvasWidth, clipId, textProperties, updateTextProperties]);

  const updateTextBoxRect = useCallback((patch: Partial<typeof textBox>) => {
    const nextBox = {
      ...textBox,
      ...patch,
    };
    updateTextProperties(clipId, {
      boxEnabled: true,
      boxX: Math.round(nextBox.x),
      boxY: Math.round(nextBox.y),
      boxWidth: Math.round(nextBox.width),
      boxHeight: Math.round(nextBox.height),
      textBounds: createTextBoundsFromRect(nextBox, canvasWidth, canvasHeight, undefined, { clampToCanvas: false }),
    });
  }, [canvasHeight, canvasWidth, clipId, textBox, updateTextProperties]);

  const straightenTextBounds = useCallback(() => {
    const currentBox = resolveTextBoxRect(textProperties, canvasWidth, canvasHeight);
    updateTextProperties(clipId, {
      boxEnabled: true,
      boxX: Math.round(currentBox.x),
      boxY: Math.round(currentBox.y),
      boxWidth: Math.round(currentBox.width),
      boxHeight: Math.round(currentBox.height),
      textBounds: createTextBoundsFromRect(currentBox, canvasWidth, canvasHeight, undefined, { clampToCanvas: false }),
    });
    useTimelineStore.getState().recordTextBoundsPathKeyframe(clipId);
  }, [canvasHeight, canvasWidth, clipId, textProperties, updateTextProperties]);

  const changeFontFamily = (newFamily: string) => {
    const weights = googleFontsService.getAvailableWeights(newFamily);
    if (!weights.includes(textProperties.fontWeight)) {
      const nearest = weights.reduce((previous, current) => (
        Math.abs(current - textProperties.fontWeight) < Math.abs(previous - textProperties.fontWeight)
          ? current
          : previous
      ));
      updateTextProperties(clipId, { fontFamily: newFamily, fontWeight: nearest });
      return;
    }
    updateProp('fontFamily', newFamily);
  };

  const colorControl = (
    value: string,
    fallback: string,
    label: string,
    onChange: (value: string) => void,
  ) => (
    <div className="tt-inspector-color-row">
      <input
        aria-label={`${label} picker`}
        className="tt-color-swatch"
        onChange={event => onChange(event.target.value)}
        onContextMenu={event => resetPropertyValueOnContextMenu(event, () => onChange(fallback))}
        title={`${label} — ${PROPERTY_VALUE_RESET_TITLE}`}
        type="color"
        value={value.startsWith('#') ? value : fallback}
      />
      <input
        aria-label={label}
        className="tt-color-hex"
        onChange={event => onChange(event.target.value)}
        onContextMenu={event => resetPropertyValueOnContextMenu(event, () => onChange(fallback))}
        title={PROPERTY_VALUE_RESET_TITLE}
        type="text"
        value={value}
      />
    </div>
  );

  return (
    <div className={`tt tt--inspector transform-tab-compact${compact ? ' tt--compact' : ''}`}>
      {!hideContent && (
        <ResolveInspectorSection indicator="none" title="Content">
          <ResolveInspectorRow label="Text">
            <textarea
              aria-label={liveText ? 'Caption text is supplied live from the transcript' : 'Text content'}
              className="tt-textarea"
              disabled={liveText}
              onChange={handleTextChange}
              placeholder={liveText ? undefined : 'Enter text...'}
              rows={2}
              value={liveText ? 'Live from transcript' : localText}
            />
          </ResolveInspectorRow>
        </ResolveInspectorSection>
      )}

      <ResolveInspectorSection indicator="none" title="Text">
        <ResolveInspectorRow label="Font">
          <InspectorSelect
            ariaLabel="Font family"
            onChange={changeFontFamily}
            onReset={() => updateTextProperties(clipId, {
              fontFamily: defaultProperties.fontFamily,
              fontWeight: defaultProperties.fontWeight,
            })}
            options={POPULAR_FONTS.map(font => ({
              label: font.family,
              style: { fontFamily: font.family },
              value: font.family,
            }))}
            value={textProperties.fontFamily}
          />
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Style">
          <div className="tt-inspector-select-pair">
            <InspectorSelect
              ariaLabel="Font weight"
              onChange={value => updateProp('fontWeight', Number(value))}
              onReset={() => updateProp('fontWeight', defaultProperties.fontWeight)}
              options={ALL_FONT_WEIGHTS.map(weight => ({
                disabled: !availableWeights.includes(weight),
                label: getFontWeightLabel(weight),
                style: {
                  fontFamily: textProperties.fontFamily,
                  fontStyle: 'normal',
                  fontWeight: weight,
                },
                title: availableWeights.includes(weight)
                  ? undefined
                  : `Not available for ${textProperties.fontFamily}`,
                value: String(weight),
              }))}
              value={String(textProperties.fontWeight)}
            />
            <InspectorSelect
              ariaLabel="Font style"
              onChange={value => updateProp('fontStyle', value as TextClipProperties['fontStyle'])}
              onReset={() => updateProp('fontStyle', defaultProperties.fontStyle)}
              options={[
                { label: 'Normal', style: { fontFamily: textProperties.fontFamily, fontStyle: 'normal', fontWeight: textProperties.fontWeight }, value: 'normal' },
                { label: 'Italic', style: { fontFamily: textProperties.fontFamily, fontStyle: 'italic', fontWeight: textProperties.fontWeight }, value: 'italic' },
              ]}
              value={textProperties.fontStyle}
            />
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Metrics">
          <div className="resolve-inspector-values resolve-inspector-values--pair">
            <TextValue title="Font Size" value={textProperties.fontSize} onChange={value => updateProp('fontSize', value)} min={8} max={500} defaultValue={defaultProperties.fontSize} />
            <span aria-hidden="true" />
            <TextValue title="Line Height" value={textProperties.lineHeight} onChange={value => updateProp('lineHeight', value)} min={0.5} max={3} step={0.1} unit="" defaultValue={defaultProperties.lineHeight} />
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Tracking">
          <div className="tt-inspector-single-value">
            <TextValue title="Letter Spacing" value={textProperties.letterSpacing} onChange={value => updateProp('letterSpacing', value)} min={-10} max={50} defaultValue={defaultProperties.letterSpacing} />
          </div>
        </ResolveInspectorRow>

        <ResolveInspectorRow label="Fill">
          {colorControl(textProperties.color, defaultProperties.color, 'Fill color', value => updateProp('color', value))}
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection
        defaultOpen={textProperties.strokeEnabled}
        enabled={textProperties.strokeEnabled}
        onEnabledChange={enabled => updateProp('strokeEnabled', enabled)}
        title="Stroke"
      >
        <ResolveInspectorRow label="Color">
          {colorControl(textProperties.strokeColor, defaultProperties.strokeColor, 'Stroke color', value => updateProp('strokeColor', value))}
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Width">
          <div className="tt-inspector-single-value">
            <TextValue title="Stroke Width" value={textProperties.strokeWidth} onChange={value => updateProp('strokeWidth', value)} min={0.5} max={20} step={0.5} defaultValue={defaultProperties.strokeWidth} />
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection indicator="none" title="Paragraph">
        <ResolveInspectorRow label="Align">
          <div className="tt-align-row">
            <button aria-label="Align left" className={textProperties.textAlign === 'left' ? 'active' : ''} onClick={() => updateProp('textAlign', 'left')} onContextMenu={event => resetPropertyValueOnContextMenu(event, () => updateProp('textAlign', defaultProperties.textAlign))} title={`Left — ${PROPERTY_VALUE_RESET_TITLE}`} type="button"><IconAlignLeft /></button>
            <button aria-label="Align center" className={textProperties.textAlign === 'center' ? 'active' : ''} onClick={() => updateProp('textAlign', 'center')} onContextMenu={event => resetPropertyValueOnContextMenu(event, () => updateProp('textAlign', defaultProperties.textAlign))} title={`Center — ${PROPERTY_VALUE_RESET_TITLE}`} type="button"><IconAlignCenter /></button>
            <button aria-label="Align right" className={textProperties.textAlign === 'right' ? 'active' : ''} onClick={() => updateProp('textAlign', 'right')} onContextMenu={event => resetPropertyValueOnContextMenu(event, () => updateProp('textAlign', defaultProperties.textAlign))} title={`Right — ${PROPERTY_VALUE_RESET_TITLE}`} type="button"><IconAlignRight /></button>
            <div className="tt-align-sep" />
            <button aria-label="Align top" className={textProperties.verticalAlign === 'top' ? 'active' : ''} onClick={() => updateProp('verticalAlign', 'top')} onContextMenu={event => resetPropertyValueOnContextMenu(event, () => updateProp('verticalAlign', defaultProperties.verticalAlign))} title={`Top — ${PROPERTY_VALUE_RESET_TITLE}`} type="button"><IconAlignTop /></button>
            <button aria-label="Align middle" className={textProperties.verticalAlign === 'middle' ? 'active' : ''} onClick={() => updateProp('verticalAlign', 'middle')} onContextMenu={event => resetPropertyValueOnContextMenu(event, () => updateProp('verticalAlign', defaultProperties.verticalAlign))} title={`Middle — ${PROPERTY_VALUE_RESET_TITLE}`} type="button"><IconAlignMiddle /></button>
            <button aria-label="Align bottom" className={textProperties.verticalAlign === 'bottom' ? 'active' : ''} onClick={() => updateProp('verticalAlign', 'bottom')} onContextMenu={event => resetPropertyValueOnContextMenu(event, () => updateProp('verticalAlign', defaultProperties.verticalAlign))} title={`Bottom — ${PROPERTY_VALUE_RESET_TITLE}`} type="button"><IconAlignBottom /></button>
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection
        defaultOpen={boxEnabled}
        enabled={boxEnabled}
        headerActions={boxEnabled ? (
          <TextBoundsPathKeyframeToggle clipId={clipId} textProperties={textProperties} canvasSize={{ width: canvasWidth, height: canvasHeight }} />
        ) : undefined}
        onEnabledChange={updateTextBoxEnabled}
        title="Area Text"
      >
        <ResolveInspectorRow label="Position">
          <div className="resolve-inspector-values resolve-inspector-values--pair">
            <TextValue title="Box X" value={Math.round(textBox.x)} onChange={value => updateTextBoxRect({ x: Math.round(value) })} min={-100000} max={100000} defaultValue={defaultProperties.boxX} />
            <span aria-hidden="true" />
            <TextValue title="Box Y" value={Math.round(textBox.y)} onChange={value => updateTextBoxRect({ y: Math.round(value) })} min={-100000} max={100000} defaultValue={defaultProperties.boxY} />
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Size">
          <div className="resolve-inspector-values resolve-inspector-values--pair">
            <TextValue title="Box Width" value={Math.round(textBox.width)} onChange={value => updateTextBoxRect({ width: Math.round(value) })} min={24} max={100000} defaultValue={defaultProperties.boxWidth} />
            <span aria-hidden="true" />
            <TextValue title="Box Height" value={Math.round(textBox.height)} onChange={value => updateTextBoxRect({ height: Math.round(value) })} min={24} max={100000} defaultValue={defaultProperties.boxHeight} />
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Bounds">
          <button className="tt-small-action" onClick={straightenTextBounds} title="Make text bounds rectangular" type="button">
            <IconStraightenBounds />
            <span>Rectangular</span>
          </button>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection
        defaultOpen={textProperties.shadowEnabled}
        enabled={textProperties.shadowEnabled}
        onEnabledChange={enabled => updateProp('shadowEnabled', enabled)}
        title="Shadow"
      >
        <ResolveInspectorRow label="Color">
          {colorControl(textProperties.shadowColor, defaultProperties.shadowColor, 'Shadow color', value => updateProp('shadowColor', value))}
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Offset">
          <div className="resolve-inspector-values resolve-inspector-values--pair">
            <TextValue title="Shadow Offset X" value={textProperties.shadowOffsetX} onChange={value => updateProp('shadowOffsetX', value)} min={-50} max={50} defaultValue={defaultProperties.shadowOffsetX} />
            <span aria-hidden="true" />
            <TextValue title="Shadow Offset Y" value={textProperties.shadowOffsetY} onChange={value => updateProp('shadowOffsetY', value)} min={-50} max={50} defaultValue={defaultProperties.shadowOffsetY} />
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Blur">
          <div className="tt-inspector-single-value">
            <TextValue title="Shadow Blur" value={textProperties.shadowBlur} onChange={value => updateProp('shadowBlur', value)} min={0} max={50} defaultValue={defaultProperties.shadowBlur} />
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>
    </div>
  );
}

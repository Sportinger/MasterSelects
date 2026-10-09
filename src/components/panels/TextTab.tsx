/**
 * Text Tab Component - Compact typography controls for text clips
 * Inspired by After Effects / professional NLE text panels
 */

import { useState, useCallback, useEffect, useMemo, useContext } from 'react';
import { createTextBoundsPathProperty } from '../../types/animationProperties';
import type { Keyframe } from '../../types/keyframes';
import type { TextClipProperties } from '../../types/text';
import { TextSelectionContext } from './properties/TextSelectionContext';
import { editTextSelection, getTextEditTargets, type EditableTextClip } from './properties/textSelectionEditing';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TEXT_PROPERTIES } from '../../stores/timeline/constants';
import { googleFontsService, POPULAR_FONTS } from '../../services/googleFontsService';
import { LabeledValue } from './properties/transformTab/ValueControls';
import { TextAnimatedNumberRow } from './properties/TextAnimatedNumberRow';
import { TextValueControls } from './properties/TextValueControls';
import { TextRevealSection } from './properties/TextRevealSection';
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
  canvasSize,
}: {
  clipId: string;
  canvasSize: { width: number; height: number };
}) {
  const selection = useContext(TextSelectionContext);
  const property = createTextBoundsPathProperty();
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYFRAMES);
  const recordingEnabled = useTimelineStore(state => state.keyframeRecordingEnabled.has(`${clipId}:${property}`));
  const hasPathKeyframes = clipKeyframes.some(keyframe => keyframe.property === property);
  const editBoundsKeyframes = (disable: boolean) => {
    const state = useTimelineStore.getState();
    editTextSelection(state, clipId, selection, clip => {
      const bounds = resolveTextBoundsPath(clip.textProperties, canvasSize.width, canvasSize.height);
      const value = getTextBoundsPathValue(bounds);
      if (disable) state.disableTextBoundsPathKeyframes(clip.id, value);
      else {
        const enableRecording = !state.isRecording(clip.id, property) && !state.hasKeyframes(clip.id, property);
        state.addTextBoundsPathKeyframe(clip.id, value);
        if (enableRecording) state.toggleKeyframeRecording(clip.id, property);
      }
    });
  };

  return (
    <button
      type="button"
      className={`keyframe-toggle ${recordingEnabled ? 'recording' : ''} ${hasPathKeyframes ? 'has-keyframes' : ''}`}
      title={recordingEnabled || hasPathKeyframes ? 'Add Text Bounds keyframe (right-click to disable)' : 'Add Text Bounds keyframe'}
      onClick={(event) => {
        event.stopPropagation();
        editBoundsKeyframes(false);
        if (event.detail > 0) event.currentTarget.blur();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        editBoundsKeyframes(true);
      }}
    >
      <StopwatchIcon />
    </button>
  );
}

interface TextTabProps {
  disabled?: boolean;
  editSelection?: boolean;
  scope?: 'all' | 'content' | 'typography' | 'layout' | 'fill' | 'stroke' | 'shadow';
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
  scope = 'all',
  disabled = false,
  editSelection = false,
}: TextTabProps) {
  const updateTextProperties = useTimelineStore(state => state.updateTextProperties);
  const locked = useTimelineStore(state => state.isExporting || state.tracks.some(track => track.locked
    && track.id === state.clips.find(clip => clip.id === clipId)?.trackId));
  const selectionCount = useTimelineStore(state => getTextEditTargets(state, clipId, editSelection).length);
  const edit = useCallback((action: (clip: EditableTextClip, primary: EditableTextClip) => void) => {
    if (!disabled) editTextSelection(useTimelineStore.getState(), clipId, editSelection, action);
  }, [clipId, disabled, editSelection]);
  const update = useCallback((props: Partial<TextClipProperties>) => {
    edit(clip => useTimelineStore.getState().updateTextProperties(clip.id, props));
  }, [edit]);
  // The draft belongs to one clip: a selection change must never commit the
  // previous clip's text into the newly selected clip.
  const [draft, setDraft] = useState({ clipId, text: textProperties.text });
  const localText = draft.clipId === clipId ? draft.text : textProperties.text;

  // Sync local text with props
  useEffect(() => {
    queueMicrotask(() => setDraft({ clipId, text: textProperties.text }));
  }, [clipId, textProperties.text]);

  // Debounced text update - 50ms for near-instant preview
  useEffect(() => {
    if (liveText || disabled || locked || draft.clipId !== clipId) return;
    const timer = setTimeout(() => {
      if (draft.text !== textProperties.text) {
        updateTextProperties(clipId, { text: draft.text });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [liveText, disabled, locked, draft, clipId, textProperties.text, updateTextProperties]);

  // Load font when component mounts
  useEffect(() => {
    googleFontsService.loadFont(textProperties.fontFamily, textProperties.fontWeight);
  }, [textProperties.fontFamily, textProperties.fontWeight]);

  useEffect(() => {
    if (!selectionPills) return;
    void googleFontsService.preloadFont(textProperties.fontFamily);
  }, [selectionPills, textProperties.fontFamily]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft({ clipId, text: e.target.value });
  }, [clipId]);

  const updateProp = useCallback(<K extends keyof TextClipProperties>(
    key: K,
    value: TextClipProperties[K]
  ) => {
    update({ [key]: value } as Partial<TextClipProperties>);
  }, [update]);

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

  const writeBox = useCallback((clip: EditableTextClip, box: typeof textBox) => {
    useTimelineStore.getState().updateTextProperties(clip.id, {
      boxEnabled: true,
      boxX: Math.round(box.x), boxY: Math.round(box.y),
      boxWidth: Math.round(box.width), boxHeight: Math.round(box.height),
      textBounds: createTextBoundsFromRect(box, canvasWidth, canvasHeight, undefined, { clampToCanvas: false }),
    });
  }, [canvasWidth, canvasHeight]);

  const updateTextBoxEnabled = useCallback((enabled: boolean) => {
    if (!enabled) { update({ boxEnabled: false }); return; }
    edit(clip => {
      // Preserve each clip's existing custom bounds when enabling area text.
      if (clip.textProperties.textBounds?.vertices.length) {
        useTimelineStore.getState().updateTextProperties(clip.id, { boxEnabled: true });
      } else writeBox(clip, resolveTextBoxRect(clip.textProperties, canvasWidth, canvasHeight));
    });
  }, [edit, update, writeBox, canvasWidth, canvasHeight]);

  const updateTextBoxRect = useCallback((patch: Partial<typeof textBox>) => {
    edit((clip, primary) => {
      const anchor = resolveTextBoxRect(primary.textProperties, canvasWidth, canvasHeight);
      const box = resolveTextBoxRect(clip.textProperties, canvasWidth, canvasHeight);
      for (const key of Object.keys(patch) as (keyof typeof textBox)[]) {
        const min = key === 'width' || key === 'height' ? 24 : -100000;
        box[key] = Math.max(min, Math.min(100000, Math.round(box[key]) + patch[key]! - Math.round(anchor[key])));
      }
      writeBox(clip, box);
    });
  }, [edit, writeBox, canvasWidth, canvasHeight]);

  const straightenTextBounds = useCallback(() => {
    edit(clip => {
      writeBox(clip, resolveTextBoxRect(clip.textProperties, canvasWidth, canvasHeight));
      useTimelineStore.getState().recordTextBoundsPathKeyframe(clip.id);
    });
  }, [edit, writeBox, canvasWidth, canvasHeight]);

  const changeFontFamily = (newFamily: string) => {
    const weights = googleFontsService.getAvailableWeights(newFamily);
    edit(clip => {
      const weight = clip.textProperties.fontWeight;
      const nearest = weights.reduce((previous, current) => (
        Math.abs(current - weight) < Math.abs(previous - weight) ? current : previous
      ));
      useTimelineStore.getState().updateTextProperties(clip.id, { fontFamily: newFamily, fontWeight: nearest });
    });
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
    <TextSelectionContext.Provider value={editSelection}>
    <fieldset disabled={disabled || locked} className="tt-edit-fields">
    <div onClick={event => {
      if (event.detail > 0 && event.target instanceof Element) event.target.closest<HTMLButtonElement>('button:not([role="combobox"]):not([role="option"])')?.blur();
    }} className={`tt tt--inspector transform-tab-compact${compact ? ' tt--compact' : ''}`}>
      {selectionCount > 1 && <p className="properties-hint">Editing {selectionCount} text clips. Numeric changes are relative; content stays with this clip.</p>}
      {!hideContent && (scope === 'all' || scope === 'content') && (
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
          {!liveText && <TextSelectionContext.Provider value={false}><TextValueControls clipId={clipId} textProperties={textProperties} disabled={disabled || locked} /></TextSelectionContext.Provider>}
        </ResolveInspectorSection>
      )}

      {(scope === 'all' || scope === 'typography' || scope === 'fill') && <ResolveInspectorSection indicator="none" title={scope === 'fill' ? 'Fill' : 'Text'}>
        {scope !== 'fill' && <>
        <ResolveInspectorRow label="Font">
          <InspectorSelect
            ariaLabel="Font family"
            wheelSelection
            disabled={disabled || locked}
            onChange={changeFontFamily}
            onReset={() => update({
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
        {(['fontSize', 'lineHeight', 'letterSpacing'] as const).map(parameter => <TextAnimatedNumberRow key={parameter}
          clipId={clipId} parameter={parameter} baseValue={textProperties[parameter]} defaultValue={defaultProperties[parameter]} disabled={disabled} animatable={!liveText} />)}

        </>}
        {scope !== 'typography' && <ResolveInspectorRow label="Fill">
          {colorControl(textProperties.color, defaultProperties.color, 'Fill color', value => updateProp('color', value))}
        </ResolveInspectorRow>}
      </ResolveInspectorSection>}

      {(scope === 'all' || scope === 'stroke') && <ResolveInspectorSection
        defaultOpen={textProperties.strokeEnabled}
        enabled={textProperties.strokeEnabled}
        onEnabledChange={enabled => updateProp('strokeEnabled', enabled)}
        title="Stroke"
      >
        <ResolveInspectorRow label="Color">
          {colorControl(textProperties.strokeColor, defaultProperties.strokeColor, 'Stroke color', value => updateProp('strokeColor', value))}
        </ResolveInspectorRow>
        <TextAnimatedNumberRow clipId={clipId} parameter="strokeWidth" baseValue={textProperties.strokeWidth}
          defaultValue={defaultProperties.strokeWidth} disabled={disabled} animatable={!liveText} />
      </ResolveInspectorSection>}

      {(scope === 'all' || scope === 'layout') && <><ResolveInspectorSection indicator="none" title="Paragraph">
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
          <TextBoundsPathKeyframeToggle clipId={clipId} canvasSize={{ width: canvasWidth, height: canvasHeight }} />
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
      </ResolveInspectorSection></>}

      {scope === 'all' && <TextRevealSection clipId={clipId} textProperties={textProperties} disabled={disabled} animatable={!liveText} />}

      {(scope === 'all' || scope === 'shadow') && <ResolveInspectorSection
        defaultOpen={textProperties.shadowEnabled}
        enabled={textProperties.shadowEnabled}
        onEnabledChange={enabled => updateProp('shadowEnabled', enabled)}
        title="Shadow"
      >
        <ResolveInspectorRow label="Color">
          {colorControl(textProperties.shadowColor, defaultProperties.shadowColor, 'Shadow color', value => updateProp('shadowColor', value))}
        </ResolveInspectorRow>
        {(['shadowOffsetX', 'shadowOffsetY', 'shadowBlur'] as const).map(parameter => <TextAnimatedNumberRow key={parameter}
          clipId={clipId} parameter={parameter} baseValue={textProperties[parameter]} defaultValue={defaultProperties[parameter]} disabled={disabled} animatable={!liveText} />)}
      </ResolveInspectorSection>}
    </div>
    </fieldset>
    </TextSelectionContext.Provider>
  );
}

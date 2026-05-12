/**
 * Text Tab Component - Compact typography controls for text clips
 * Inspired by After Effects / professional NLE text panels
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { createTextBoundsPathProperty, type Keyframe, type TextClipProperties } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { googleFontsService, POPULAR_FONTS } from '../../services/googleFontsService';
import {
  createTextBoundsFromRect,
  getTextBoundsPathValue,
  resolveTextBoundsPath,
  resolveTextBoxRect,
} from '../../services/textLayout';

const EMPTY_KEYFRAMES: Keyframe[] = [];

// Compact draggable number with icon label
interface CompactNumberProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  icon: React.ReactNode;
  title: string;
}

interface CompactNumberDragState {
  startValue: number;
  lastClientX: number;
  accumulatedDelta: number;
  pointerLockRequested: boolean;
  pointerLockActive: boolean;
  element: HTMLElement;
}

function CompactNumber({ value, onChange, min = 0, max = 999, step = 1, unit = 'px', icon, title }: CompactNumberProps) {
  const dragStateRef = useRef<CompactNumberDragState | null>(null);

  const readDragDeltaX = useCallback((event: MouseEvent) => {
    const state = dragStateRef.current;
    if (!state) return 0;

    const isPointerLocked = state.pointerLockActive || document.pointerLockElement === state.element;
    const movementX = Number.isFinite(event.movementX) ? event.movementX : 0;
    if (isPointerLocked) return movementX;

    const clientDx = event.clientX - state.lastClientX;
    state.lastClientX = event.clientX;

    if (
      state.pointerLockRequested &&
      movementX !== 0 &&
      Math.abs(clientDx) > Math.abs(movementX) * 4 + 8
    ) {
      return movementX;
    }

    return clientDx;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    const element = e.currentTarget as HTMLElement;
    dragStateRef.current = {
      startValue: value,
      lastClientX: e.clientX,
      accumulatedDelta: 0,
      pointerLockRequested: false,
      pointerLockActive: false,
      element,
    };

    const handlePointerLockChange = () => {
      const state = dragStateRef.current;
      if (state) {
        state.pointerLockActive = document.pointerLockElement === state.element;
      }
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);

    if (element.requestPointerLock) {
      dragStateRef.current.pointerLockRequested = true;
      try {
        const result = element.requestPointerLock();
        if (result && typeof result.then === 'function') {
          void result.then(
            () => {
              const state = dragStateRef.current;
              if (state) state.pointerLockActive = document.pointerLockElement === state.element;
            },
            () => {
              const state = dragStateRef.current;
              if (state) {
                state.pointerLockRequested = false;
                state.pointerLockActive = false;
              }
            },
          );
        }
      } catch {
        dragStateRef.current.pointerLockRequested = false;
        dragStateRef.current.pointerLockActive = false;
      }
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      if ((moveEvent.buttons & 1) !== 1) {
        handleMouseUp();
        return;
      }

      state.accumulatedDelta += readDragDeltaX(moveEvent);
      const sensitivity = step < 1 ? 0.5 : (step >= 10 ? 5 : 1);
      const newValue = state.startValue + Math.round(state.accumulatedDelta / sensitivity) * step;
      onChange(Math.max(min, Math.min(max, newValue)));
    };

    const handleMouseUp = () => {
      const state = dragStateRef.current;
      if (state && document.pointerLockElement === state.element) {
        document.exitPointerLock?.();
      }
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      dragStateRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [value, readDragDeltaX, onChange, min, max, step]);

  return (
    <div className="tt-compact-num" title={title} onMouseDown={handleMouseDown}>
      <span className="tt-num-icon">{icon}</span>
      <input
        type="number"
        value={step < 1 ? value.toFixed(1) : value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || min)))}
        min={min}
        max={max}
        step={step}
      />
      <span className="tt-num-unit">{unit}</span>
    </div>
  );
}

// SVG Icons as inline components
const IconFontSize = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <text x="0" y="12" fontSize="11" fontWeight="bold" fontFamily="Arial">T</text>
    <text x="7" y="12" fontSize="8" fontWeight="bold" fontFamily="Arial">T</text>
  </svg>
);

const IconLineHeight = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path d="M2 1h10M2 13h10M7 3v8M5 5l2-2 2 2M5 9l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
  </svg>
);

const IconLetterSpacing = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <text x="1" y="10" fontSize="9" fontWeight="bold" fontFamily="Arial">V</text>
    <text x="7" y="10" fontSize="9" fontWeight="bold" fontFamily="Arial">A</text>
  </svg>
);

const IconBoxSize = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.3" fill="none">
    <rect x="2" y="2" width="10" height="10" rx="1" />
    <path d="M4 5h6M4 7h5M4 9h4" />
  </svg>
);

const IconBoxPosition = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.3" fill="none">
    <path d="M7 1v12M1 7h12" />
    <rect x="4" y="4" width="6" height="6" rx="1" />
  </svg>
);

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
}

export function TextTab({ clipId, textProperties, canvasSize = { width: 1920, height: 1080 } }: TextTabProps) {
  const { updateTextProperties } = useTimelineStore();
  const [localText, setLocalText] = useState(textProperties.text);

  // Sync local text with props
  useEffect(() => {
    queueMicrotask(() => setLocalText(textProperties.text));
  }, [textProperties.text]);

  // Debounced text update - 50ms for near-instant preview
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localText !== textProperties.text) {
        updateTextProperties(clipId, { text: localText });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [localText, clipId, textProperties.text, updateTextProperties]);

  // Load font when component mounts
  useEffect(() => {
    googleFontsService.loadFont(textProperties.fontFamily, textProperties.fontWeight);
  }, [textProperties.fontFamily, textProperties.fontWeight]);

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

  return (
    <div className="tt">
      {/* Text Content */}
      <div className="tt-section">
        <textarea
          className="tt-textarea"
          value={localText}
          onChange={handleTextChange}
          placeholder="Enter text..."
          rows={2}
        />
      </div>

      {/* Font */}
      <div className="tt-section">
        <div className="tt-section-header">Text</div>
        <select
          className="tt-select-full"
          value={textProperties.fontFamily}
          onChange={(e) => {
            const newFamily = e.target.value;
            const weights = googleFontsService.getAvailableWeights(newFamily);
            // Auto-adjust weight to nearest available for the new font
            if (!weights.includes(textProperties.fontWeight)) {
              const nearest = weights.reduce((prev, curr) =>
                Math.abs(curr - textProperties.fontWeight) < Math.abs(prev - textProperties.fontWeight) ? curr : prev
              );
              updateTextProperties(clipId, { fontFamily: newFamily, fontWeight: nearest });
            } else {
              updateProp('fontFamily', newFamily);
            }
          }}
          style={{ fontFamily: textProperties.fontFamily }}
        >
          {POPULAR_FONTS.map(font => (
            <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>
              {font.family}
            </option>
          ))}
        </select>

        <div className="tt-row-2col">
          <select
            className="tt-select-full"
            value={textProperties.fontWeight}
            onChange={(e) => updateProp('fontWeight', parseInt(e.target.value))}
          >
            {availableWeights.map(w => (
              <option key={w} value={w}>{
                w === 100 ? 'Thin' :
                w === 200 ? 'Extra Light' :
                w === 300 ? 'Light' :
                w === 400 ? 'Regular' :
                w === 500 ? 'Medium' :
                w === 600 ? 'Semi Bold' :
                w === 700 ? 'Bold' :
                w === 800 ? 'Extra Bold' :
                w === 900 ? 'Black' : `${w}`
              }</option>
            ))}
          </select>
          <select
            className="tt-select-full"
            value={textProperties.fontStyle}
            onChange={(e) => updateProp('fontStyle', e.target.value as 'normal' | 'italic')}
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </div>

        {/* Size + Line Height */}
        <div className="tt-row-2col">
          <CompactNumber
            icon={<IconFontSize />}
            title="Font Size"
            value={textProperties.fontSize}
            onChange={(v) => updateProp('fontSize', v)}
            min={8}
            max={500}
            unit="px"
          />
          <CompactNumber
            icon={<IconLineHeight />}
            title="Line Height"
            value={textProperties.lineHeight}
            onChange={(v) => updateProp('lineHeight', v)}
            min={0.5}
            max={3}
            step={0.1}
            unit=""
          />
        </div>

        {/* Letter Spacing */}
        <div className="tt-row-2col">
          <CompactNumber
            icon={<IconLetterSpacing />}
            title="Letter Spacing"
            value={textProperties.letterSpacing}
            onChange={(v) => updateProp('letterSpacing', v)}
            min={-10}
            max={50}
            unit="px"
          />
          <div className="tt-compact-num" style={{ visibility: 'hidden' }} />
        </div>

        {/* Fill + Stroke inline */}
        <div className="tt-color-row">
          <input
            type="color"
            className="tt-color-swatch"
            value={textProperties.color.startsWith('#') ? textProperties.color : '#ffffff'}
            onChange={(e) => updateProp('color', e.target.value)}
            title="Fill Color"
          />
          <span className="tt-color-label">Fill</span>
          <input
            type="text"
            className="tt-color-hex"
            value={textProperties.color}
            onChange={(e) => updateProp('color', e.target.value)}
          />
        </div>

        <div className="tt-color-row">
          <label className="tt-toggle">
            <input
              type="checkbox"
              checked={textProperties.strokeEnabled}
              onChange={(e) => updateProp('strokeEnabled', e.target.checked)}
            />
            <span className="tt-toggle-box" />
          </label>
          <input
            type="color"
            className="tt-color-swatch"
            value={textProperties.strokeColor.startsWith('#') ? textProperties.strokeColor : '#000000'}
            onChange={(e) => updateProp('strokeColor', e.target.value)}
            title="Stroke Color"
            disabled={!textProperties.strokeEnabled}
          />
          <span className="tt-color-label">Stroke</span>
          {textProperties.strokeEnabled && (
            <CompactNumber
              icon={<></>}
              title="Stroke Width"
              value={textProperties.strokeWidth}
              onChange={(v) => updateProp('strokeWidth', v)}
              min={0.5}
              max={20}
              step={0.5}
              unit="px"
            />
          )}
        </div>
      </div>

      {/* Alignment */}
      <div className="tt-section">
        <div className="tt-section-header">Paragraph</div>
        <div className="tt-align-row">
          <button className={textProperties.textAlign === 'left' ? 'active' : ''} onClick={() => updateProp('textAlign', 'left')} title="Left"><IconAlignLeft /></button>
          <button className={textProperties.textAlign === 'center' ? 'active' : ''} onClick={() => updateProp('textAlign', 'center')} title="Center"><IconAlignCenter /></button>
          <button className={textProperties.textAlign === 'right' ? 'active' : ''} onClick={() => updateProp('textAlign', 'right')} title="Right"><IconAlignRight /></button>
          <div className="tt-align-sep" />
          <button className={textProperties.verticalAlign === 'top' ? 'active' : ''} onClick={() => updateProp('verticalAlign', 'top')} title="Top"><IconAlignTop /></button>
          <button className={textProperties.verticalAlign === 'middle' ? 'active' : ''} onClick={() => updateProp('verticalAlign', 'middle')} title="Middle"><IconAlignMiddle /></button>
          <button className={textProperties.verticalAlign === 'bottom' ? 'active' : ''} onClick={() => updateProp('verticalAlign', 'bottom')} title="Bottom"><IconAlignBottom /></button>
        </div>
      </div>

      {/* Area Text */}
      <div className="tt-section">
        <div className="tt-section-header">
          {boxEnabled && (
            <TextBoundsPathKeyframeToggle
              clipId={clipId}
              textProperties={textProperties}
              canvasSize={{ width: canvasWidth, height: canvasHeight }}
            />
          )}
          <label className="tt-toggle-header">
            <input
              type="checkbox"
              checked={boxEnabled}
              onChange={(e) => updateTextBoxEnabled(e.target.checked)}
            />
            Area Text
          </label>
        </div>
        {boxEnabled && (
          <>
            <div className="tt-row-2col">
              <CompactNumber
                icon={<IconBoxPosition />}
                title="Box X"
                value={Math.round(textBox.x)}
                onChange={(v) => updateTextBoxRect({ x: Math.round(v) })}
                min={-100000}
                max={100000}
                unit="px"
              />
              <CompactNumber
                icon={<IconBoxPosition />}
                title="Box Y"
                value={Math.round(textBox.y)}
                onChange={(v) => updateTextBoxRect({ y: Math.round(v) })}
                min={-100000}
                max={100000}
                unit="px"
              />
            </div>
            <div className="tt-row-2col">
              <CompactNumber
                icon={<IconBoxSize />}
                title="Box Width"
                value={Math.round(textBox.width)}
                onChange={(v) => updateTextBoxRect({ width: Math.round(v) })}
                min={24}
                max={100000}
                unit="px"
              />
              <CompactNumber
                icon={<IconBoxSize />}
                title="Box Height"
                value={Math.round(textBox.height)}
                onChange={(v) => updateTextBoxRect({ height: Math.round(v) })}
                min={24}
                max={100000}
                unit="px"
              />
            </div>
            <button
              type="button"
              className="tt-small-action"
              title="Make text bounds rectangular"
              onClick={straightenTextBounds}
            >
              <IconStraightenBounds />
              <span>Rectangular Bounds</span>
            </button>
          </>
        )}
      </div>

      {/* Shadow */}
      <div className="tt-section">
        <div className="tt-section-header">
          <label className="tt-toggle-header">
            <input
              type="checkbox"
              checked={textProperties.shadowEnabled}
              onChange={(e) => updateProp('shadowEnabled', e.target.checked)}
            />
            Shadow
          </label>
        </div>
        {textProperties.shadowEnabled && (
          <>
            <div className="tt-color-row">
              <input
                type="color"
                className="tt-color-swatch"
                value={textProperties.shadowColor.startsWith('#') ? textProperties.shadowColor : '#000000'}
                onChange={(e) => updateProp('shadowColor', e.target.value)}
                title="Shadow Color"
              />
              <span className="tt-color-label">Color</span>
            </div>
            <div className="tt-row-2col">
              <CompactNumber icon={<span style={{ fontSize: 9 }}>X</span>} title="Shadow Offset X" value={textProperties.shadowOffsetX} onChange={(v) => updateProp('shadowOffsetX', v)} min={-50} max={50} unit="px" />
              <CompactNumber icon={<span style={{ fontSize: 9 }}>Y</span>} title="Shadow Offset Y" value={textProperties.shadowOffsetY} onChange={(v) => updateProp('shadowOffsetY', v)} min={-50} max={50} unit="px" />
            </div>
            <div className="tt-row-2col">
              <CompactNumber icon={<span style={{ fontSize: 9 }}>B</span>} title="Shadow Blur" value={textProperties.shadowBlur} onChange={(v) => updateProp('shadowBlur', v)} min={0} max={50} unit="px" />
              <div className="tt-compact-num" style={{ visibility: 'hidden' }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

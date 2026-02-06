/**
 * Text Tab Component - Compact typography controls for text clips
 * Inspired by After Effects / professional NLE text panels
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TextClipProperties } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { googleFontsService, POPULAR_FONTS } from '../../services/googleFontsService';

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

function CompactNumber({ value, onChange, min = 0, max = 999, step = 1, unit = 'px', icon, title }: CompactNumberProps) {
  const dragStartRef = useRef<{ x: number; value: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, value };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const delta = moveEvent.clientX - dragStartRef.current.x;
      const sensitivity = step < 1 ? 0.5 : (step >= 10 ? 5 : 1);
      const newValue = dragStartRef.current.value + Math.round(delta / sensitivity) * step;
      onChange(Math.max(min, Math.min(max, newValue)));
    };

    const handleMouseUp = () => {
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [value, onChange, min, max, step]);

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

interface TextTabProps {
  clipId: string;
  textProperties: TextClipProperties;
}

export function TextTab({ clipId, textProperties }: TextTabProps) {
  const { updateTextProperties } = useTimelineStore();
  const [localText, setLocalText] = useState(textProperties.text);

  // Sync local text with props
  useEffect(() => {
    setLocalText(textProperties.text);
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
          onChange={(e) => updateProp('fontFamily', e.target.value)}
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
            <option value={100}>Thin</option>
            <option value={200}>Extra Light</option>
            <option value={300}>Light</option>
            <option value={400}>Regular</option>
            <option value={500}>Medium</option>
            <option value={600}>Semi Bold</option>
            <option value={700}>Bold</option>
            <option value={800}>Extra Bold</option>
            <option value={900}>Black</option>
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

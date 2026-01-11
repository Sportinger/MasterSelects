/**
 * Text Tab Component - Typography controls for text clips
 * Part of PropertiesPanel
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TextClipProperties } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { googleFontsService, POPULAR_FONTS } from '../../services/googleFontsService';

// Draggable number input component for quick value adjustments
interface DraggableNumberProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label: string;
}

function DraggableNumber({ value, onChange, min = 8, max = 500, step = 1, unit = 'px', label }: DraggableNumberProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; value: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking on the input itself
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, value };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const delta = moveEvent.clientX - dragStartRef.current.x;
      // Adjust sensitivity based on step size
      const sensitivity = step < 1 ? 0.5 : (step >= 10 ? 5 : 1);
      const newValue = dragStartRef.current.value + Math.round(delta / sensitivity) * step;
      const clampedValue = Math.max(min, Math.min(max, newValue));
      onChange(clampedValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [value, onChange, min, max, step]);

  return (
    <div className="control-row">
      <label
        className={`draggable-label ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleMouseDown}
        style={{ cursor: 'ew-resize', userSelect: 'none' }}
      >
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
        min={min}
        max={max}
        step={step}
      />
      <span className="unit">{unit}</span>
    </div>
  );
}

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

  // Debounced text update
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localText !== textProperties.text) {
        updateTextProperties(clipId, { text: localText });
      }
    }, 300);
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
    <div className="text-tab">
      {/* Text Content */}
      <div className="properties-section">
        <h4>Content</h4>
        <textarea
          className="text-content-input"
          value={localText}
          onChange={handleTextChange}
          placeholder="Enter text..."
          rows={4}
        />
      </div>

      {/* Font Selection */}
      <div className="properties-section">
        <h4>Font</h4>

        {/* Font Family */}
        <div className="control-row">
          <label>Family</label>
          <select
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
        </div>

        {/* Font Size - Draggable */}
        <DraggableNumber
          label="Size"
          value={textProperties.fontSize}
          onChange={(v) => updateProp('fontSize', v)}
          min={8}
          max={500}
          step={1}
          unit="px"
        />

        {/* Font Weight */}
        <div className="control-row">
          <label>Weight</label>
          <select
            value={textProperties.fontWeight}
            onChange={(e) => updateProp('fontWeight', parseInt(e.target.value))}
          >
            <option value={100}>Thin (100)</option>
            <option value={200}>Extra Light (200)</option>
            <option value={300}>Light (300)</option>
            <option value={400}>Regular (400)</option>
            <option value={500}>Medium (500)</option>
            <option value={600}>Semi Bold (600)</option>
            <option value={700}>Bold (700)</option>
            <option value={800}>Extra Bold (800)</option>
            <option value={900}>Black (900)</option>
          </select>
        </div>

        {/* Font Style */}
        <div className="control-row">
          <label>Style</label>
          <select
            value={textProperties.fontStyle}
            onChange={(e) => updateProp('fontStyle', e.target.value as 'normal' | 'italic')}
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </div>
      </div>

      {/* Color */}
      <div className="properties-section">
        <h4>Color</h4>
        <div className="control-row">
          <label>Fill</label>
          <input
            type="color"
            value={textProperties.color.startsWith('#') ? textProperties.color : '#ffffff'}
            onChange={(e) => updateProp('color', e.target.value)}
          />
          <input
            type="text"
            value={textProperties.color}
            onChange={(e) => updateProp('color', e.target.value)}
            placeholder="#ffffff"
            style={{ width: '80px' }}
          />
        </div>
      </div>

      {/* Alignment */}
      <div className="properties-section">
        <h4>Alignment</h4>
        <div className="control-row">
          <label>Horizontal</label>
          <div className="button-group">
            <button
              className={textProperties.textAlign === 'left' ? 'active' : ''}
              onClick={() => updateProp('textAlign', 'left')}
              title="Left"
            >
              L
            </button>
            <button
              className={textProperties.textAlign === 'center' ? 'active' : ''}
              onClick={() => updateProp('textAlign', 'center')}
              title="Center"
            >
              C
            </button>
            <button
              className={textProperties.textAlign === 'right' ? 'active' : ''}
              onClick={() => updateProp('textAlign', 'right')}
              title="Right"
            >
              R
            </button>
          </div>
        </div>
        <div className="control-row">
          <label>Vertical</label>
          <div className="button-group">
            <button
              className={textProperties.verticalAlign === 'top' ? 'active' : ''}
              onClick={() => updateProp('verticalAlign', 'top')}
              title="Top"
            >
              T
            </button>
            <button
              className={textProperties.verticalAlign === 'middle' ? 'active' : ''}
              onClick={() => updateProp('verticalAlign', 'middle')}
              title="Middle"
            >
              M
            </button>
            <button
              className={textProperties.verticalAlign === 'bottom' ? 'active' : ''}
              onClick={() => updateProp('verticalAlign', 'bottom')}
              title="Bottom"
            >
              B
            </button>
          </div>
        </div>
      </div>

      {/* Spacing */}
      <div className="properties-section">
        <h4>Spacing</h4>
        <div className="control-row">
          <label>Line Height</label>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={textProperties.lineHeight}
            onChange={(e) => updateProp('lineHeight', parseFloat(e.target.value))}
          />
          <span>{textProperties.lineHeight.toFixed(1)}</span>
        </div>
        <div className="control-row">
          <label>Letter Spacing</label>
          <input
            type="range"
            min={-10}
            max={50}
            step={1}
            value={textProperties.letterSpacing}
            onChange={(e) => updateProp('letterSpacing', parseInt(e.target.value))}
          />
          <span>{textProperties.letterSpacing}px</span>
        </div>
      </div>

      {/* Stroke (Outline) */}
      <div className="properties-section">
        <h4>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={textProperties.strokeEnabled}
              onChange={(e) => updateProp('strokeEnabled', e.target.checked)}
            />
            Stroke
          </label>
        </h4>
        {textProperties.strokeEnabled && (
          <>
            <div className="control-row">
              <label>Color</label>
              <input
                type="color"
                value={textProperties.strokeColor.startsWith('#') ? textProperties.strokeColor : '#000000'}
                onChange={(e) => updateProp('strokeColor', e.target.value)}
              />
            </div>
            <div className="control-row">
              <label>Width</label>
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={textProperties.strokeWidth}
                onChange={(e) => updateProp('strokeWidth', parseFloat(e.target.value))}
              />
              <span>{textProperties.strokeWidth}px</span>
            </div>
          </>
        )}
      </div>

      {/* Shadow */}
      <div className="properties-section">
        <h4>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={textProperties.shadowEnabled}
              onChange={(e) => updateProp('shadowEnabled', e.target.checked)}
            />
            Shadow
          </label>
        </h4>
        {textProperties.shadowEnabled && (
          <>
            <div className="control-row">
              <label>Color</label>
              <input
                type="color"
                value={textProperties.shadowColor.startsWith('#') || textProperties.shadowColor.startsWith('rgba')
                  ? (textProperties.shadowColor.startsWith('#') ? textProperties.shadowColor : '#000000')
                  : '#000000'}
                onChange={(e) => updateProp('shadowColor', e.target.value)}
              />
            </div>
            <div className="control-row">
              <label>Offset X</label>
              <input
                type="range"
                min={-50}
                max={50}
                step={1}
                value={textProperties.shadowOffsetX}
                onChange={(e) => updateProp('shadowOffsetX', parseInt(e.target.value))}
              />
              <span>{textProperties.shadowOffsetX}px</span>
            </div>
            <div className="control-row">
              <label>Offset Y</label>
              <input
                type="range"
                min={-50}
                max={50}
                step={1}
                value={textProperties.shadowOffsetY}
                onChange={(e) => updateProp('shadowOffsetY', parseInt(e.target.value))}
              />
              <span>{textProperties.shadowOffsetY}px</span>
            </div>
            <div className="control-row">
              <label>Blur</label>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={textProperties.shadowBlur}
                onChange={(e) => updateProp('shadowBlur', parseInt(e.target.value))}
              />
              <span>{textProperties.shadowBlur}px</span>
            </div>
          </>
        )}
      </div>

      {/* Font Preview */}
      <div className="properties-section">
        <h4>Preview</h4>
        <div
          className="text-preview"
          style={{
            fontFamily: textProperties.fontFamily,
            fontSize: '24px',
            fontWeight: textProperties.fontWeight,
            fontStyle: textProperties.fontStyle,
            color: textProperties.color,
            textAlign: textProperties.textAlign,
            WebkitTextStroke: textProperties.strokeEnabled
              ? `${textProperties.strokeWidth / 4}px ${textProperties.strokeColor}`
              : 'none',
            textShadow: textProperties.shadowEnabled
              ? `${textProperties.shadowOffsetX / 4}px ${textProperties.shadowOffsetY / 4}px ${textProperties.shadowBlur / 4}px ${textProperties.shadowColor}`
              : 'none',
          }}
        >
          {localText || 'Preview'}
        </div>
      </div>
    </div>
  );
}

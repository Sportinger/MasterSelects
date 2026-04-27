import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Text3DProperties } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { DraggableNumber } from './shared';
import type { MIDIParameterTarget } from '../../../types/midi';
import { MIDIParameterLabel } from './MIDIParameterLabel';

interface ThreeDTextTabProps {
  clipId: string;
  text3DProperties: Text3DProperties;
}

const FONT_OPTIONS: Array<{ value: Text3DProperties['fontFamily']; label: string }> = [
  { value: 'helvetiker', label: 'Helvetiker' },
  { value: 'optimer', label: 'Optimer' },
  { value: 'gentilis', label: 'Gentilis' },
];

function LabeledNumber({
  label,
  value,
  onChange,
  defaultValue,
  decimals = 2,
  suffix = '',
  min,
  max,
  midiTarget,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  decimals?: number;
  suffix?: string;
  min?: number;
  max?: number;
  midiTarget?: MIDIParameterTarget | null;
}) {
  return (
    <div className="labeled-value">
      <MIDIParameterLabel as="span" className="labeled-value-label" target={midiTarget}>
        {label}
      </MIDIParameterLabel>
      <DraggableNumber
        value={value}
        onChange={onChange}
        defaultValue={defaultValue}
        decimals={decimals}
        suffix={suffix}
        min={min}
        max={max}
        onDragStart={() => startBatch('Adjust 3D text')}
        onDragEnd={() => endBatch()}
      />
    </div>
  );
}

export function ThreeDTextTab({ clipId, text3DProperties }: ThreeDTextTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((entry) => entry.id === clipId));
  const [localText, setLocalText] = useState(text3DProperties.text);
  const { updateText3DProperties, updateClipTransform } = useTimelineStore.getState();

  useEffect(() => {
    setLocalText(text3DProperties.text);
  }, [text3DProperties.text]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (localText !== text3DProperties.text) {
        updateText3DProperties(clipId, { text: localText });
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [clipId, localText, text3DProperties.text, updateText3DProperties]);

  const scale = useMemo(() => ({
    x: clip?.transform.scale.x ?? 1,
    y: clip?.transform.scale.y ?? 1,
    z: clip?.transform.scale.z ?? 1,
  }), [clip?.transform.scale.x, clip?.transform.scale.y, clip?.transform.scale.z]);

  const updateProp = useCallback(<K extends keyof Text3DProperties>(
    key: K,
    value: Text3DProperties[K],
  ) => {
    updateText3DProperties(clipId, { [key]: value } as Partial<Text3DProperties>);
  }, [clipId, updateText3DProperties]);

  const updateScaleAxis = useCallback((axis: 'x' | 'y' | 'z', value: number) => {
    const currentScale = clip?.transform.scale ?? { x: 1, y: 1, z: 1 };
    updateClipTransform(clipId, {
      scale: {
        ...currentScale,
        [axis]: value,
      },
    });
  }, [clip?.transform.scale, clipId, updateClipTransform]);

  const createText3DMIDITarget = useCallback((
    property: string,
    label: string,
    currentValue: number,
    min?: number,
    max?: number,
  ): MIDIParameterTarget => ({
    clipId,
    property,
    label: `${clip?.name ?? '3D Text'} / ${label}`,
    currentValue,
    min,
    max,
  }), [clip?.name, clipId]);

  return (
    <div className="properties-tab-content transform-tab-compact">
      <div className="properties-section">
        <textarea
          className="tt-textarea"
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          placeholder="3D Text..."
          rows={3}
        />
      </div>

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Font</label>
          <select
            value={text3DProperties.fontFamily}
            onChange={(e) => updateProp('fontFamily', e.target.value as Text3DProperties['fontFamily'])}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value}>{font.label}</option>
            ))}
          </select>
          <select
            value={text3DProperties.fontWeight}
            onChange={(e) => updateProp('fontWeight', e.target.value as Text3DProperties['fontWeight'])}
          >
            <option value="regular">Regular</option>
            <option value="bold">Bold</option>
          </select>
        </div>

        <div className="control-row" style={{ alignItems: 'center' }}>
          <label className="prop-label">Color</label>
          <input
            type="color"
            value={text3DProperties.color.startsWith('#') ? text3DProperties.color : '#ffffff'}
            onChange={(e) => updateProp('color', e.target.value)}
            style={{ width: '28px', height: '22px', padding: 0 }}
          />
          <input
            type="text"
            value={text3DProperties.color}
            onChange={(e) => updateProp('color', e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </div>

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Geometry</label>
          <div className="multi-value-row">
            <LabeledNumber label="Size" value={text3DProperties.size} onChange={(value) => updateProp('size', value)} defaultValue={0.42} decimals={2} min={0.05} midiTarget={createText3DMIDITarget('text3d.size', '3D Text Size', text3DProperties.size, 0.05, 4)} />
            <LabeledNumber label="Depth" value={text3DProperties.depth} onChange={(value) => updateProp('depth', value)} defaultValue={0.14} decimals={2} min={0.01} midiTarget={createText3DMIDITarget('text3d.depth', '3D Text Depth', text3DProperties.depth, 0.01, 2)} />
            <LabeledNumber label="Segs" value={text3DProperties.curveSegments} onChange={(value) => updateProp('curveSegments', Math.max(1, Math.round(value)))} defaultValue={10} decimals={0} min={1} max={32} midiTarget={createText3DMIDITarget('text3d.curveSegments', '3D Text Segments', text3DProperties.curveSegments, 1, 32)} />
          </div>
        </div>

        <div className="control-row">
          <label className="prop-label">Spacing</label>
          <div className="multi-value-row">
            <LabeledNumber label="Letters" value={text3DProperties.letterSpacing} onChange={(value) => updateProp('letterSpacing', value)} defaultValue={0.02} decimals={2} midiTarget={createText3DMIDITarget('text3d.letterSpacing', '3D Text Letter Spacing', text3DProperties.letterSpacing, -0.5, 0.5)} />
            <LabeledNumber label="Lines" value={text3DProperties.lineHeight} onChange={(value) => updateProp('lineHeight', value)} defaultValue={1.15} decimals={2} min={0.5} max={3} midiTarget={createText3DMIDITarget('text3d.lineHeight', '3D Text Line Height', text3DProperties.lineHeight, 0.5, 3)} />
          </div>
        </div>
      </div>

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Scale</label>
          <div className="multi-value-row">
            <LabeledNumber label="X" value={scale.x * 100} onChange={(value) => updateScaleAxis('x', value / 100)} defaultValue={100} decimals={1} suffix="%" min={1} midiTarget={createText3DMIDITarget('scale.x', '3D Text Scale X', scale.x, 0.01, 4)} />
            <LabeledNumber label="Y" value={scale.y * 100} onChange={(value) => updateScaleAxis('y', value / 100)} defaultValue={100} decimals={1} suffix="%" min={1} midiTarget={createText3DMIDITarget('scale.y', '3D Text Scale Y', scale.y, 0.01, 4)} />
            <LabeledNumber label="Z" value={scale.z * 100} onChange={(value) => updateScaleAxis('z', value / 100)} defaultValue={100} decimals={1} suffix="%" min={1} midiTarget={createText3DMIDITarget('scale.z', '3D Text Scale Z', scale.z, 0.01, 4)} />
          </div>
        </div>
      </div>

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Align</label>
          <div className="multi-value-row">
            <button className={`btn btn-xs ${text3DProperties.textAlign === 'left' ? 'btn-active' : ''}`} onClick={() => updateProp('textAlign', 'left')}>Left</button>
            <button className={`btn btn-xs ${text3DProperties.textAlign === 'center' ? 'btn-active' : ''}`} onClick={() => updateProp('textAlign', 'center')}>Center</button>
            <button className={`btn btn-xs ${text3DProperties.textAlign === 'right' ? 'btn-active' : ''}`} onClick={() => updateProp('textAlign', 'right')}>Right</button>
          </div>
        </div>

        <div className="control-row">
          <label className="prop-label">Bevel</label>
          <button
            className={`btn btn-xs ${text3DProperties.bevelEnabled ? 'btn-active' : ''}`}
            onClick={() => updateProp('bevelEnabled', !text3DProperties.bevelEnabled)}
          >
            {text3DProperties.bevelEnabled ? 'On' : 'Off'}
          </button>
          {text3DProperties.bevelEnabled && (
            <div className="multi-value-row">
              <LabeledNumber label="Size" value={text3DProperties.bevelSize} onChange={(value) => updateProp('bevelSize', value)} defaultValue={0.01} decimals={2} min={0} midiTarget={createText3DMIDITarget('text3d.bevelSize', '3D Text Bevel Size', text3DProperties.bevelSize, 0, 0.5)} />
              <LabeledNumber label="Depth" value={text3DProperties.bevelThickness} onChange={(value) => updateProp('bevelThickness', value)} defaultValue={0.02} decimals={2} min={0} midiTarget={createText3DMIDITarget('text3d.bevelThickness', '3D Text Bevel Depth', text3DProperties.bevelThickness, 0, 0.5)} />
              <LabeledNumber label="Segs" value={text3DProperties.bevelSegments} onChange={(value) => updateProp('bevelSegments', Math.max(1, Math.round(value)))} defaultValue={4} decimals={0} min={1} max={16} midiTarget={createText3DMIDITarget('text3d.bevelSegments', '3D Text Bevel Segments', text3DProperties.bevelSegments, 1, 16)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

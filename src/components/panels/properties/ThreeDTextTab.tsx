import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Text3DProperties } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../../stores/timeline/constants';
import { startBatch, endBatch } from '../../../stores/historyStore';
import type { MIDIParameterTarget } from '../../../types/midi';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import {
  ResolveInspectorRow,
  ResolveInspectorSection,
} from './resolveInspector/ResolveInspectorPrimitives';
import { LabeledValue } from './transformTab/ValueControls';
import {
  PROPERTY_VALUE_RESET_TITLE,
  resetPropertyValueOnContextMenu,
} from './propertyValueReset';
import './ThreeDTextInspector.css';

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
    <LabeledValue
      ariaLabel={label}
      className="resolve-inspector-field"
      decimals={decimals}
      defaultValue={defaultValue}
      label={label}
      max={max}
      midiTarget={midiTarget}
      min={min}
      onChange={onChange}
      onDragEnd={() => endBatch()}
      onDragStart={() => startBatch('Adjust 3D text')}
      suffix={suffix}
      value={value}
    />
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
    <div className="properties-tab-content transform-tab-compact text3d-inspector">
      <ResolveInspectorSection indicator="none" title="Text">
        <ResolveInspectorRow label="Content">
          <textarea
            aria-label="3D text content"
            className="text3d-inspector-textarea"
            onChange={(event) => setLocalText(event.target.value)}
            placeholder="3D Text..."
            rows={2}
            value={localText}
          />
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Font">
          <div className="text3d-inspector-select-pair">
            <div
              onContextMenu={(event) => resetPropertyValueOnContextMenu(
                event,
                () => updateProp('fontFamily', DEFAULT_TEXT_3D_PROPERTIES.fontFamily),
              )}
              title={PROPERTY_VALUE_RESET_TITLE}
            >
              <InspectorSelect
                ariaLabel="3D text font"
                onChange={value => updateProp('fontFamily', value)}
                options={FONT_OPTIONS}
                value={text3DProperties.fontFamily}
              />
            </div>
            <div
              onContextMenu={(event) => resetPropertyValueOnContextMenu(
                event,
                () => updateProp('fontWeight', DEFAULT_TEXT_3D_PROPERTIES.fontWeight),
              )}
              title={PROPERTY_VALUE_RESET_TITLE}
            >
              <InspectorSelect
                ariaLabel="3D text font weight"
                onChange={value => updateProp('fontWeight', value)}
                options={[{ label: 'Regular', value: 'regular' }, { label: 'Bold', value: 'bold' }]}
                value={text3DProperties.fontWeight}
              />
            </div>
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Color">
          <div className="text3d-inspector-color">
            <input
              aria-label="3D text color"
              onChange={(event) => updateProp('color', event.target.value)}
              onContextMenu={(event) => resetPropertyValueOnContextMenu(event, () => updateProp('color', DEFAULT_TEXT_3D_PROPERTIES.color))}
              type="color"
              value={text3DProperties.color.startsWith('#') ? text3DProperties.color : '#ffffff'}
            />
            <input
              aria-label="3D text color value"
              onChange={(event) => updateProp('color', event.target.value)}
              onContextMenu={(event) => resetPropertyValueOnContextMenu(event, () => updateProp('color', DEFAULT_TEXT_3D_PROPERTIES.color))}
              type="text"
              value={text3DProperties.color}
            />
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection indicator="none" title="Geometry">
        <ResolveInspectorRow label="Geometry">
          <div className="resolve-inspector-values resolve-inspector-values--triple">
            <LabeledNumber label="Size" value={text3DProperties.size} onChange={(value) => updateProp('size', value)} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.size} decimals={2} min={0.05} midiTarget={createText3DMIDITarget('text3d.size', '3D Text Size', text3DProperties.size, 0.05, 4)} />
            <LabeledNumber label="Depth" value={text3DProperties.depth} onChange={(value) => updateProp('depth', value)} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.depth} decimals={2} min={0.01} midiTarget={createText3DMIDITarget('text3d.depth', '3D Text Depth', text3DProperties.depth, 0.01, 2)} />
            <LabeledNumber label="Segs" value={text3DProperties.curveSegments} onChange={(value) => updateProp('curveSegments', Math.max(1, Math.round(value)))} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.curveSegments} decimals={0} min={1} max={32} midiTarget={createText3DMIDITarget('text3d.curveSegments', '3D Text Segments', text3DProperties.curveSegments, 1, 32)} />
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Spacing">
          <div className="resolve-inspector-values resolve-inspector-values--pair text3d-inspector-pair">
            <LabeledNumber label="Letters" value={text3DProperties.letterSpacing} onChange={(value) => updateProp('letterSpacing', value)} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.letterSpacing} decimals={2} midiTarget={createText3DMIDITarget('text3d.letterSpacing', '3D Text Letter Spacing', text3DProperties.letterSpacing, -0.5, 0.5)} />
            <span aria-hidden="true" />
            <LabeledNumber label="Lines" value={text3DProperties.lineHeight} onChange={(value) => updateProp('lineHeight', value)} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.lineHeight} decimals={2} min={0.5} max={3} midiTarget={createText3DMIDITarget('text3d.lineHeight', '3D Text Line Height', text3DProperties.lineHeight, 0.5, 3)} />
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection indicator="none" title="Scale">
        <ResolveInspectorRow label="Scale">
          <div className="resolve-inspector-values resolve-inspector-values--triple">
            <LabeledNumber label="X" value={scale.x * 100} onChange={(value) => updateScaleAxis('x', value / 100)} defaultValue={100} decimals={1} suffix="%" min={1} midiTarget={createText3DMIDITarget('scale.x', '3D Text Scale X', scale.x, 0.01, 4)} />
            <LabeledNumber label="Y" value={scale.y * 100} onChange={(value) => updateScaleAxis('y', value / 100)} defaultValue={100} decimals={1} suffix="%" min={1} midiTarget={createText3DMIDITarget('scale.y', '3D Text Scale Y', scale.y, 0.01, 4)} />
            <LabeledNumber label="Z" value={scale.z * 100} onChange={(value) => updateScaleAxis('z', value / 100)} defaultValue={100} decimals={1} suffix="%" min={1} midiTarget={createText3DMIDITarget('scale.z', '3D Text Scale Z', scale.z, 0.01, 4)} />
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection indicator="none" title="Paragraph">
        <ResolveInspectorRow label="Align">
          <div className="text3d-inspector-segmented">
            {(['left', 'center', 'right'] as const).map(alignment => (
              <button
                aria-pressed={text3DProperties.textAlign === alignment}
                className={text3DProperties.textAlign === alignment ? 'is-active' : ''}
                key={alignment}
                onClick={() => updateProp('textAlign', alignment)}
                onContextMenu={(event) => resetPropertyValueOnContextMenu(event, () => updateProp('textAlign', DEFAULT_TEXT_3D_PROPERTIES.textAlign))}
                title={PROPERTY_VALUE_RESET_TITLE}
                type="button"
              >
                {alignment[0]?.toUpperCase()}{alignment.slice(1)}
              </button>
            ))}
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection
        defaultOpen={text3DProperties.bevelEnabled}
        enabled={text3DProperties.bevelEnabled}
        onEnabledChange={enabled => updateProp('bevelEnabled', enabled)}
        title="Bevel"
      >
        <ResolveInspectorRow label="Geometry">
          <div className="resolve-inspector-values resolve-inspector-values--triple">
            <LabeledNumber label="Size" value={text3DProperties.bevelSize} onChange={(value) => updateProp('bevelSize', value)} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.bevelSize} decimals={2} min={0} midiTarget={createText3DMIDITarget('text3d.bevelSize', '3D Text Bevel Size', text3DProperties.bevelSize, 0, 0.5)} />
            <LabeledNumber label="Depth" value={text3DProperties.bevelThickness} onChange={(value) => updateProp('bevelThickness', value)} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.bevelThickness} decimals={2} min={0} midiTarget={createText3DMIDITarget('text3d.bevelThickness', '3D Text Bevel Depth', text3DProperties.bevelThickness, 0, 0.5)} />
            <LabeledNumber label="Segs" value={text3DProperties.bevelSegments} onChange={(value) => updateProp('bevelSegments', Math.max(1, Math.round(value)))} defaultValue={DEFAULT_TEXT_3D_PROPERTIES.bevelSegments} decimals={0} min={1} max={16} midiTarget={createText3DMIDITarget('text3d.bevelSegments', '3D Text Bevel Segments', text3DProperties.bevelSegments, 1, 16)} />
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>
    </div>
  );
}

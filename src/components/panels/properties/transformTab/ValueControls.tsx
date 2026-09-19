import type { ReactNode } from 'react';

import { DraggableNumber } from '../shared';
import { MIDIParameterLabel } from '../MIDIParameterLabel';
import {
  LabeledValue as SharedLabeledValue,
  type LabeledValueProps,
} from '../LabeledValue';
import type { MidiParameterTargetView } from './transformTabTypes';
import { trackEditorControlCommitted } from '../../../../services/productAnalytics';

function trackTransformControl(property: string, method: 'drag' | 'reset' | 'type', suffix?: string) {
  trackEditorControlCommitted({
    area: property.startsWith('camera.') ? 'camera' : 'transform',
    controlId: suffix ? `${property}.${suffix}` : property,
    controlKind: 'number',
    inputMethod: method,
    interaction: method === 'reset' ? 'reset' : 'change',
    itemId: property,
    itemKind: 'property',
  });
}

export function LabeledValue({
  midiTarget,
  onCommit,
  touchDragAxis = 'horizontal',
  ...props
}: LabeledValueProps) {
  return (
    <SharedLabeledValue
      {...props}
      touchDragAxis={touchDragAxis}
      midiTarget={midiTarget}
      onCommit={(method) => {
        onCommit?.(method);
        if (midiTarget?.property) trackTransformControl(midiTarget.property, method);
      }}
    />
  );
}

export function RotationValue({
  label,
  degrees,
  onChange,
  onDragStart,
  onDragEnd,
  midiTarget,
  keyframeToggle,
}: {
  label: string;
  degrees: number;
  onChange: (degrees: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  midiTarget?: MidiParameterTargetView | null;
  keyframeToggle?: ReactNode;
}) {
  const revolutions = Math.trunc(degrees / 360);
  const remainder = degrees - revolutions * 360;

  return (
    <div
      className={`labeled-value rotation-value-ae ${keyframeToggle ? 'with-keyframe-toggle' : ''}`}
      data-guided-property={midiTarget?.property}
      data-guided-clip-id={midiTarget?.clipId}
      data-guided-target={midiTarget ? `property:${midiTarget.property}` : undefined}
    >
      {keyframeToggle}
      <MIDIParameterLabel as="span" className="labeled-value-label" target={midiTarget}>
        {label}
      </MIDIParameterLabel>
      <DraggableNumber
        value={revolutions}
        onChange={(rev) => onChange(Math.round(rev) * 360 + remainder)}
        defaultValue={0}
        decimals={0}
        suffix="x"
        sensitivity={4}
        touchDragAxis="horizontal"
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onCommit={(method) => {
          if (midiTarget?.property) trackTransformControl(midiTarget.property, method, 'revolutions');
        }}
      />
      <DraggableNumber
        value={remainder}
        onChange={(rem) => onChange(revolutions * 360 + rem)}
        defaultValue={0}
        decimals={1}
        suffix="deg"
        sensitivity={0.5}
        touchDragAxis="horizontal"
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onCommit={(method) => {
          if (midiTarget?.property) trackTransformControl(midiTarget.property, method, 'degrees');
        }}
      />
    </div>
  );
}

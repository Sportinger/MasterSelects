import type { ComponentProps, ReactNode } from 'react';

import { DraggableNumber } from '../shared';
import { MIDIParameterLabel } from '../MIDIParameterLabel';
import type { MidiParameterTargetView } from './transformTabTypes';

export function LabeledValue({
  label,
  wip,
  midiTarget,
  keyframeToggle,
  ...props
}: {
  label: string;
  wip?: boolean;
  midiTarget?: MidiParameterTargetView | null;
  keyframeToggle?: ReactNode;
} & ComponentProps<typeof DraggableNumber>) {
  return (
    <div
      className={`labeled-value ${keyframeToggle ? 'with-keyframe-toggle' : ''}`}
      data-guided-property={midiTarget?.property}
      data-guided-clip-id={midiTarget?.clipId}
      data-guided-target={midiTarget ? `property:${midiTarget.property}` : undefined}
    >
      {keyframeToggle}
      <MIDIParameterLabel as="span" className="labeled-value-label" target={midiTarget}>
        {label}
        {wip && <span className="menu-wip-badge">WIP</span>}
      </MIDIParameterLabel>
      <DraggableNumber {...props} />
    </div>
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
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      <DraggableNumber
        value={remainder}
        onChange={(rem) => onChange(revolutions * 360 + rem)}
        defaultValue={0}
        decimals={1}
        suffix="deg"
        sensitivity={0.5}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </div>
  );
}

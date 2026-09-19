import type { ComponentProps, ReactNode } from 'react';

import type { MIDIParameterTarget } from '../../../types/midi';
import { MIDIParameterLabel } from './MIDIParameterLabel';
import { DraggableNumber } from './shared';

export type LabeledValueProps = {
  className?: string;
  label: string;
  wip?: boolean;
  midiTarget?: MIDIParameterTarget | null;
  keyframeToggle?: ReactNode;
} & ComponentProps<typeof DraggableNumber>;

/**
 * Shared numeric property control used by Transform and Effects.
 * Interaction, editing, touch feedback, reset, and range settings all come
 * from the same EditableDraggableNumber module.
 */
export function LabeledValue({
  className,
  label,
  wip,
  midiTarget,
  keyframeToggle,
  ...props
}: LabeledValueProps) {
  return (
    <div
      className={[
        'labeled-value',
        keyframeToggle ? 'with-keyframe-toggle' : '',
        className,
      ].filter(Boolean).join(' ')}
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

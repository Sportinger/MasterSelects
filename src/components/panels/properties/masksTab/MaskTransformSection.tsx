import { createMaskNumericProperty, type MaskProperty } from '../../../../types/animationProperties';
import type { ClipMask } from '../../../../types/masks';
import { DraggableNumber, KeyframeToggle } from '../shared';
import { MIDIParameterLabel } from '../MIDIParameterLabel';

interface MaskTransformSectionProps {
  activeMask: ClipMask;
  clipId: string;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  setPropertyValue: (clipId: string, property: MaskProperty, value: number) => void;
}

export function MaskTransformSection({
  activeMask,
  clipId,
  onBatchEnd,
  onBatchStart,
  setPropertyValue,
}: MaskTransformSectionProps) {
  const rotationProperty = createMaskNumericProperty(activeMask.id, 'rotation');
  const rotation = activeMask.rotation ?? 0;

  return (
    <div className="mask-property-groups">
      <div className="mask-property-group">
        <h5>Transform</h5>
        <div className="control-row">
          <MIDIParameterLabel
            as="label"
            target={{
              clipId,
              property: rotationProperty,
              label: `${activeMask.name} / Rotation`,
              currentValue: rotation,
              min: -3600,
              max: 3600,
            }}
          >
            Rotation
          </MIDIParameterLabel>
          <KeyframeToggle clipId={clipId} property={rotationProperty} value={rotation} />
          <DraggableNumber
            ariaLabel={`${activeMask.name} rotation`}
            value={rotation}
            onChange={value => setPropertyValue(clipId, rotationProperty, value)}
            defaultValue={0}
            min={-3600}
            max={3600}
            sensitivity={0.5}
            decimals={1}
            suffix="°"
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
          />
        </div>
      </div>
    </div>
  );
}

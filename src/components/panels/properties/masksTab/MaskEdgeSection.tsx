import { createMaskEdgeFeatherProperty, createMaskNumericProperty, type MaskProperty } from "../../../../types/animationProperties";
import type { ClipMask } from "../../../../types/masks";
import { getMaskEdgeFeather } from '../../../../utils/maskEdgeFeathers';
import { DraggableNumber, KeyframeToggle } from '../shared';
import { PrecisionSlider } from '../DragValueInputs';
import { MIDIParameterLabel } from '../MIDIParameterLabel';
import { MaskPathKeyframeToggle } from './MaskPathKeyframeToggle';

interface MaskEdgeSectionProps {
  activeMask: ClipMask;
  clipId: string;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  selectedMaskEdgeId: string | null;
  showMaskFeatherPreview: (maskId: string, edgeId?: string | null) => void;
  setPropertyValue: (clipId: string, property: MaskProperty, value: number) => void;
}

export function MaskEdgeSection({
  activeMask,
  clipId,
  onBatchEnd,
  onBatchStart,
  selectedMaskEdgeId,
  showMaskFeatherPreview,
  setPropertyValue,
}: MaskEdgeSectionProps) {
  const featherProperty = createMaskNumericProperty(activeMask.id, 'feather');
  const featherQualityProperty = createMaskNumericProperty(activeMask.id, 'featherQuality');
  const edgeFeatherProperty = selectedMaskEdgeId
    ? createMaskEdgeFeatherProperty(activeMask.id, selectedMaskEdgeId)
    : null;
  const selectedEdgeFeather = getMaskEdgeFeather(activeMask, selectedMaskEdgeId);
  const setFeather = (value: number) => {
    setPropertyValue(clipId, featherProperty, Math.max(0, value));
    showMaskFeatherPreview(activeMask.id, null);
  };
  const setSelectedEdgeFeather = (value: number) => {
    if (!selectedMaskEdgeId || !edgeFeatherProperty) return;
    setPropertyValue(clipId, edgeFeatherProperty, Math.max(0, value));
    showMaskFeatherPreview(activeMask.id, selectedMaskEdgeId);
  };
  const setFeatherQuality = (value: number) => {
    setPropertyValue(clipId, featherQualityProperty, Math.min(100, Math.max(1, Math.round(value))));
  };

  return (
    <div className="mask-property-groups">
      <div className="mask-property-group">
        <h5>Edge</h5>
        <div className="control-row mask-path-row">
          <label>Mask Path</label>
          <MaskPathKeyframeToggle clipId={clipId} mask={activeMask} />
          <span>{activeMask.vertices.length} vertices</span>
        </div>
        <div className="control-row">
          <MIDIParameterLabel
            as="label"
            target={{
              clipId,
              property: `mask.${activeMask.id}.feather`,
              label: `${activeMask.name} / Feather`,
              currentValue: activeMask.feather,
              min: 0,
              max: 500,
            }}
          >
            Feather
          </MIDIParameterLabel>
          <KeyframeToggle clipId={clipId} property={featherProperty} value={activeMask.feather} />
          <PrecisionSlider
            value={activeMask.feather}
            onChange={setFeather}
            defaultValue={0}
            min={0}
            max={500}
            step={1}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
          />
          <DraggableNumber
            value={activeMask.feather}
            onChange={setFeather}
            defaultValue={0}
            min={0}
            max={500}
            sensitivity={1}
            decimals={1}
            suffix="px"
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
          />
        </div>
        {selectedMaskEdgeId && (
          <div className="control-row">
            <MIDIParameterLabel
              as="label"
              target={{
                clipId,
                property: edgeFeatherProperty!,
                label: `${activeMask.name} / Edge Feather`,
                currentValue: selectedEdgeFeather,
                min: 0,
                max: 500,
              }}
            >
              Edge Feather
            </MIDIParameterLabel>
            <KeyframeToggle clipId={clipId} property={edgeFeatherProperty!} value={selectedEdgeFeather} />
            <PrecisionSlider
              value={selectedEdgeFeather}
              onChange={setSelectedEdgeFeather}
              defaultValue={0}
              min={0}
              max={500}
              step={1}
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
            />
            <DraggableNumber
              value={selectedEdgeFeather}
              onChange={setSelectedEdgeFeather}
              defaultValue={0}
              min={0}
              max={500}
              sensitivity={1}
              decimals={1}
              suffix="px"
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
            />
          </div>
        )}
        <div className="control-row">
          <MIDIParameterLabel
            as="label"
            target={{
              clipId,
              property: `mask.${activeMask.id}.featherQuality`,
              label: `${activeMask.name} / Quality`,
              currentValue: activeMask.featherQuality ?? 50,
              min: 1,
              max: 100,
            }}
          >
            Quality
          </MIDIParameterLabel>
          <KeyframeToggle
            clipId={clipId}
            property={featherQualityProperty}
            value={activeMask.featherQuality ?? 50}
          />
          <DraggableNumber
            value={activeMask.featherQuality ?? 50}
            onChange={setFeatherQuality}
            defaultValue={50}
            min={1}
            max={100}
            sensitivity={1}
            decimals={0}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
          />
        </div>
      </div>
    </div>
  );
}

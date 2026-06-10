import { KeyframeToggle } from '../shared';
import { LabeledValue } from './ValueControls';
import type { ScaleValueContext } from './transformValues';
import type { CreateMidiTarget, TransformTabTransform } from './transformTabTypes';

interface ScaleSectionProps {
  clipId: string;
  createMidiTarget: CreateMidiTarget;
  scaleValues: ScaleValueContext;
  supportsScaleZ: boolean;
  transform: TransformTabTransform;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onScaleAllChange: (pct: number) => void;
  onScaleXChange: (pct: number) => void;
  onScaleYChange: (pct: number) => void;
  onScaleZChange: (pct: number) => void;
}

export function ScaleSection({
  clipId,
  createMidiTarget,
  scaleValues,
  supportsScaleZ,
  transform,
  onBatchEnd,
  onBatchStart,
  onScaleAllChange,
  onScaleXChange,
  onScaleYChange,
  onScaleZChange,
}: ScaleSectionProps) {
  return (
    <div className="properties-section">
      <div className="control-row transform-param-row">
        <span className="keyframe-toggle-placeholder" />
        <label className="prop-label">Scale</label>
        <div className="multi-value-row">
          <LabeledValue
            label="All"
            value={scaleValues.scaleAllPct}
            onChange={onScaleAllChange}
            defaultValue={100}
            decimals={1}
            suffix="%"
            min={1}
            sensitivity={1}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.all" value={scaleValues.scaleAll} />}
            midiTarget={createMidiTarget('scale.all', 'Scale All', scaleValues.scaleAll, 0.01, 4)}
          />
          <LabeledValue
            label="X"
            value={scaleValues.scaleXPct}
            onChange={onScaleXChange}
            defaultValue={100}
            decimals={1}
            suffix="%"
            min={1}
            sensitivity={1}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.x" value={transform.scale.x} />}
            midiTarget={createMidiTarget('scale.x', 'Scale X', transform.scale.x, 0.01, 4)}
          />
          <LabeledValue
            label="Y"
            value={scaleValues.scaleYPct}
            onChange={onScaleYChange}
            defaultValue={100}
            decimals={1}
            suffix="%"
            min={1}
            sensitivity={1}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.y" value={transform.scale.y} />}
            midiTarget={createMidiTarget('scale.y', 'Scale Y', transform.scale.y, 0.01, 4)}
          />
          {supportsScaleZ && (
            <LabeledValue
              label="Z"
              value={scaleValues.scaleZPct}
              onChange={onScaleZChange}
              defaultValue={100}
              decimals={1}
              suffix="%"
              min={1}
              sensitivity={1}
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
              keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.z" value={transform.scale.z ?? 1} />}
              midiTarget={createMidiTarget('scale.z', 'Scale Z', transform.scale.z ?? 1, 0.01, 4)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

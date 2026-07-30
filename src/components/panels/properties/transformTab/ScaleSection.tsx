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
  onFitToFrame?: () => void;
  onScaleAllChange: (pct: number) => void;
  onFlipX: () => void;
  onFlipY: () => void;
  onScaleXChange: (pct: number) => void;
  onScaleYChange: (pct: number) => void;
  onScaleZChange: (pct: number) => void;
}

function ScaleFlipIcon({ axis }: { axis: 'x' | 'y' }) {
  return axis === 'x' ? (
    <svg className="scale-flip-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path className="scale-flip-axis" d="M12 3v18" />
      <path d="M9.5 6 4 12l5.5 6V6Zm5 0 5.5 6-5.5 6V6Z" />
    </svg>
  ) : (
    <svg className="scale-flip-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path className="scale-flip-axis" d="M3 12h18" />
      <path d="m6 9.5 6-5.5 6 5.5H6Zm0 5 6 5.5 6-5.5H6Z" />
    </svg>
  );
}

export function ScaleSection({
  clipId,
  createMidiTarget,
  scaleValues,
  supportsScaleZ,
  transform,
  onBatchEnd,
  onBatchStart,
  onFitToFrame,
  onScaleAllChange,
  onFlipX,
  onFlipY,
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
            sensitivity={1}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.x" value={transform.scale.x} />}
            midiTarget={createMidiTarget('scale.x', 'Scale X', transform.scale.x, -4, 4)}
          />
          <LabeledValue
            label="Y"
            value={scaleValues.scaleYPct}
            onChange={onScaleYChange}
            defaultValue={100}
            decimals={1}
            suffix="%"
            sensitivity={1}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.y" value={transform.scale.y} />}
            midiTarget={createMidiTarget('scale.y', 'Scale Y', transform.scale.y, -4, 4)}
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
          <div className="scale-flip-controls" role="group" aria-label="Scale actions">
            {onFitToFrame && (
              <button
                type="button"
                className="scale-fit-button"
                onClick={onFitToFrame}
                aria-label="Fit source to composition"
                title="Fit source to composition"
              >
                Fit
              </button>
            )}
            <button
              type="button"
              className={`scale-flip-button${transform.scale.x < 0 ? ' is-active' : ''}`}
              onClick={onFlipX}
              aria-label="Flip horizontal"
              aria-pressed={transform.scale.x < 0}
              title="Flip horizontal (Scale X)"
            >
              <ScaleFlipIcon axis="x" />
            </button>
            <button
              type="button"
              className={`scale-flip-button${transform.scale.y < 0 ? ' is-active' : ''}`}
              onClick={onFlipY}
              aria-label="Flip vertical"
              aria-pressed={transform.scale.y < 0}
              title="Flip vertical (Scale Y)"
            >
              <ScaleFlipIcon axis="y" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

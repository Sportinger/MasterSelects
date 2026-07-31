import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types';
import type {
  ReplicatorLayout,
  ShapePrimitive,
} from '../../../types/motionDesign';
import { createDefaultReplicatorDefinition } from '../../../types/motionDesign';
import { DraggableNumber, KeyframeToggle } from './shared';
import { MotionAppearanceStackEditor } from './MotionAppearanceStackEditor';
import { MotionPropertyBrowser } from './MotionPropertyBrowser';

interface MotionShapeTabProps {
  clipId: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function NumberRow({
  clipId,
  label,
  property,
  value,
  min,
  max,
  suffix,
  defaultValue,
}: {
  clipId: string;
  label: string;
  property: AnimatableProperty;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  defaultValue?: number;
}) {
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);

  return (
    <div className="labeled-value with-keyframe-toggle">
      <KeyframeToggle clipId={clipId} property={property} value={value} />
      <span className="labeled-value-label">{label}</span>
      <DraggableNumber
        value={value}
        onChange={(nextValue) => setPropertyValue(clipId, property, nextValue)}
        min={min}
        max={max}
        suffix={suffix}
        defaultValue={defaultValue}
      />
    </div>
  );
}

function getGridLayout(layout: ReplicatorLayout | undefined): Extract<ReplicatorLayout, { mode: 'grid' }> {
  if (layout?.mode === 'grid') return layout;
  return createDefaultReplicatorDefinition().layout as Extract<ReplicatorLayout, { mode: 'grid' }>;
}

export function MotionShapeTab({ clipId }: MotionShapeTabProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const updateMotionLayer = useTimelineStore(state => state.updateMotionLayer);
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);

  const motion = clip?.motion;
  const shape = motion?.shape;
  const replicator = motion?.replicator ?? createDefaultReplicatorDefinition();
  const gridLayout = getGridLayout(replicator.layout);

  const updatePrimitive = useCallback((primitive: ShapePrimitive) => {
    updateMotionLayer(clipId, (current) => ({
      ...current,
      shape: current.shape
        ? {
            ...current.shape,
            primitive,
            cornerRadius: primitive === 'rectangle' ? current.shape.cornerRadius ?? 0 : undefined,
          }
        : current.shape,
    }));
  }, [clipId, updateMotionLayer]);

  const setReplicatorEnabled = useCallback((enabled: boolean) => {
    updateMotionLayer(clipId, (current) => {
      const currentReplicator = current.replicator ?? createDefaultReplicatorDefinition();
      return {
        ...current,
        replicator: {
          ...currentReplicator,
          enabled,
          layout: getGridLayout(currentReplicator.layout),
        },
      };
    });
  }, [clipId, updateMotionLayer]);

  if (!clip || !motion || !shape) {
    return <div className="properties-tab-content"><div className="panel-empty"><p>Select a motion shape clip</p></div></div>;
  }

  return (
    <div className="properties-tab-content transform-tab-compact">
      <MotionPropertyBrowser clipId={clipId} />

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Shape</label>
          <select
            aria-label="Motion shape primitive"
            value={shape.primitive}
            onChange={(event) => updatePrimitive(event.target.value as ShapePrimitive)}
          >
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="polygon">Polygon</option>
            <option value="star">Star</option>
          </select>
        </div>

        <NumberRow
          clipId={clipId}
          label="W"
          property="shape.size.w"
          value={shape.size.w}
          min={1}
          suffix="px"
          defaultValue={320}
        />
        <NumberRow
          clipId={clipId}
          label="H"
          property="shape.size.h"
          value={shape.size.h}
          min={1}
          suffix="px"
          defaultValue={180}
        />
        {shape.primitive === 'rectangle' && (
          <NumberRow
            clipId={clipId}
            label="Radius"
            property="shape.cornerRadius"
            value={shape.cornerRadius ?? 0}
            min={0}
            suffix="px"
            defaultValue={0}
          />
        )}
        {shape.primitive === 'polygon' && (
          <>
            <NumberRow
              clipId={clipId}
              label="Points"
              property="shape.polygon.points"
              value={shape.polygon?.points ?? 6}
              min={3}
              max={32}
              defaultValue={6}
            />
            <NumberRow
              clipId={clipId}
              label="Radius"
              property="shape.polygon.radius"
              value={shape.polygon?.radius ?? Math.min(shape.size.w, shape.size.h) / 2}
              min={1}
              suffix="px"
              defaultValue={90}
            />
            <NumberRow
              clipId={clipId}
              label="Corner"
              property="shape.polygon.cornerRadius"
              value={shape.polygon?.cornerRadius ?? 0}
              min={0}
              suffix="px"
              defaultValue={0}
            />
          </>
        )}
        {shape.primitive === 'star' && (
          <>
            <NumberRow
              clipId={clipId}
              label="Points"
              property="shape.star.points"
              value={shape.star?.points ?? 5}
              min={3}
              max={32}
              defaultValue={5}
            />
            <NumberRow
              clipId={clipId}
              label="Outer"
              property="shape.star.outerRadius"
              value={shape.star?.outerRadius ?? Math.min(shape.size.w, shape.size.h) / 2}
              min={shape.star?.innerRadius ?? 1}
              suffix="px"
              defaultValue={90}
            />
            <NumberRow
              clipId={clipId}
              label="Inner"
              property="shape.star.innerRadius"
              value={shape.star?.innerRadius ?? Math.min(shape.size.w, shape.size.h) / 4}
              min={0.5}
              max={shape.star?.outerRadius ?? Math.min(shape.size.w, shape.size.h) / 2}
              suffix="px"
              defaultValue={45}
            />
            <NumberRow
              clipId={clipId}
              label="Corner"
              property="shape.star.cornerRadius"
              value={shape.star?.cornerRadius ?? 0}
              min={0}
              suffix="px"
              defaultValue={0}
            />
          </>
        )}
      </div>

      <MotionAppearanceStackEditor clipId={clipId} />

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Replicator</label>
          <input
            type="checkbox"
            checked={replicator.enabled}
            onChange={(event) => setReplicatorEnabled(event.target.checked)}
          />
          <select value="grid" onChange={() => undefined} disabled={!replicator.enabled}>
            <option value="grid">Grid</option>
          </select>
        </div>
        {replicator.enabled && (
          <>
            <NumberRow
              clipId={clipId}
              label="Count X"
              property="replicator.count.x"
              value={gridLayout.count.x}
              min={1}
              max={10}
              defaultValue={3}
            />
            <NumberRow
              clipId={clipId}
              label="Count Y"
              property="replicator.count.y"
              value={gridLayout.count.y}
              min={1}
              max={10}
              defaultValue={3}
            />
            <NumberRow
              clipId={clipId}
              label="Spacing X"
              property="replicator.spacing.x"
              value={gridLayout.spacing.x}
              suffix="px"
              defaultValue={120}
            />
            <NumberRow
              clipId={clipId}
              label="Spacing Y"
              property="replicator.spacing.y"
              value={gridLayout.spacing.y}
              suffix="px"
              defaultValue={120}
            />
            <div className="labeled-value with-keyframe-toggle">
              <KeyframeToggle
                clipId={clipId}
                property="replicator.offset.opacity"
                value={replicator.offset.opacity}
              />
              <span className="labeled-value-label">Fade</span>
              <DraggableNumber
                value={Math.round(replicator.offset.opacity * 100)}
                onChange={(value) => setPropertyValue(clipId, 'replicator.offset.opacity', clamp01(value / 100))}
                min={0}
                max={100}
                suffix="%"
                defaultValue={100}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

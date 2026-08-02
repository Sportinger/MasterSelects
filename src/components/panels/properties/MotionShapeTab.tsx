import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types';
import type {
  MotionLayerDefinition,
  ReplicatorDefinition,
  ReplicatorLayout,
  ShapePrimitive,
} from '../../../types/motionDesign';
import {
  createDefaultPathShape,
  createDefaultReplicatorDefinition,
} from '../../../types/motionDesign';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { normalizeMotionReplicatorBundle } from '../../../services/motionDesign/contracts/replicatorTimelineAdapter';
import {
  planMotionReplicatorSemanticOperation,
  type MotionReplicatorSemanticOperation,
} from '../../../services/motionDesign/replicator/semanticOperations';
import { DraggableNumber, KeyframeToggle } from './shared';
import { MotionAppearanceStackEditor } from './MotionAppearanceStackEditor';
import { MotionExpressionsSection } from './MotionExpressionsSection';
import { MotionPropertyBrowser } from './MotionPropertyBrowser';
import { MotionModifiersSection } from './MotionModifiersSection';
import { MotionTemplatesSection } from './MotionTemplatesSection';

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
  onDragStart,
  onDragEnd,
}: {
  clipId: string;
  label: string;
  property: AnimatableProperty;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  defaultValue?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
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
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </div>
  );
}

function getGridLayout(layout: ReplicatorLayout | undefined): Extract<ReplicatorLayout, { mode: 'grid' }> {
  if (layout?.mode === 'grid') return layout;
  return createDefaultReplicatorDefinition().layout as Extract<ReplicatorLayout, { mode: 'grid' }>;
}

function createLayoutForMode(
  mode: ReplicatorLayout['mode'],
  current: ReplicatorLayout,
): ReplicatorLayout {
  if (current.mode === mode) return structuredClone(current);
  if (mode === 'linear') {
    return { mode, count: 3, step: { x: 120, y: 0 } };
  }
  if (mode === 'radial') {
    return {
      mode,
      count: 8,
      center: { x: 0, y: 0 },
      radius: 180,
      startAngleDegrees: 0,
      endAngleDegrees: 360,
      angleSampling: 'exclusive-end',
      autoOrient: false,
    };
  }
  return getGridLayout(current);
}

function applyReplicatorOperation(
  motion: MotionLayerDefinition,
  createOperation: (replicator: ReplicatorDefinition) => MotionReplicatorSemanticOperation,
): MotionLayerDefinition {
  const bundle = motion.replicator
    ? normalizeMotionReplicatorBundle(motion.replicator, motion.modifierStack)
    : { replicator: createDefaultReplicatorDefinition(), modifierStack: motion.modifierStack };
  const plan = planMotionReplicatorSemanticOperation(
    bundle.replicator,
    createOperation(bundle.replicator),
  );
  if (!plan.ok) return motion;
  return {
    ...motion,
    replicator: plan.contract,
    ...(bundle.modifierStack === undefined
      ? {}
      : { modifierStack: bundle.modifierStack }),
  };
}

export function MotionShapeTab({ clipId }: MotionShapeTabProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const updateMotionLayer = useTimelineStore(state => state.updateMotionLayer);
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);

  const motion = clip?.motion;
  const shape = motion?.shape;
  const replicator = motion?.replicator
    ? normalizeMotionReplicatorBundle(
        motion.replicator,
        motion.modifierStack,
      ).replicator
    : createDefaultReplicatorDefinition();
  const gridLayout = getGridLayout(replicator.layout);
  const linearLayout = replicator.layout.mode === 'linear' ? replicator.layout : null;
  const radialLayout = replicator.layout.mode === 'radial' ? replicator.layout : null;

  const updatePrimitive = useCallback((primitive: ShapePrimitive) => {
    updateMotionLayer(clipId, (current) => ({
      ...current,
      shape: current.shape
        ? {
            ...current.shape,
            primitive,
            cornerRadius: primitive === 'rectangle' ? current.shape.cornerRadius ?? 0 : undefined,
            polygon: primitive === 'polygon' ? current.shape.polygon : undefined,
            star: primitive === 'star' ? current.shape.star : undefined,
            path: primitive === 'path'
              ? current.shape.path ?? createDefaultPathShape(current.shape.size)
              : undefined,
          }
        : current.shape,
    }));
  }, [clipId, updateMotionLayer]);

  const setPathClosed = useCallback((closed: boolean) => {
    updateMotionLayer(clipId, (current) => current.shape?.primitive === 'path'
      ? {
          ...current,
          shape: {
            ...current.shape,
            path: {
              ...(current.shape.path ?? createDefaultPathShape(current.shape.size)),
              closed,
            },
          },
        }
      : current);
  }, [clipId, updateMotionLayer]);

  const handlePathDragStart = useCallback(() => startBatch('Adjust motion path'), []);
  const handlePathDragEnd = useCallback(() => endBatch(), []);

  const setReplicatorEnabled = useCallback((enabled: boolean) => {
    updateMotionLayer(clipId, (current) => applyReplicatorOperation(
      current,
      (currentReplicator) => ({
        type: 'set-enabled',
        expectedRevision: currentReplicator.revision,
        enabled,
      }),
    ));
  }, [clipId, updateMotionLayer]);

  const setReplicatorMode = useCallback((mode: ReplicatorLayout['mode']) => {
    updateMotionLayer(clipId, (current) => applyReplicatorOperation(
      current,
      (currentReplicator) => ({
        type: 'set-layout',
        expectedRevision: currentReplicator.revision,
        layout: createLayoutForMode(mode, currentReplicator.layout),
      }),
    ));
  }, [clipId, updateMotionLayer]);

  const setRadialOption = useCallback((option: {
    angleSampling?: 'inclusive-end' | 'exclusive-end';
    autoOrient?: boolean;
  }) => {
    updateMotionLayer(clipId, (current) => applyReplicatorOperation(
      current,
      (currentReplicator) => {
        const layout = createLayoutForMode('radial', currentReplicator.layout);
        if (layout.mode !== 'radial') throw new Error('Expected radial layout');
        return {
          type: 'set-layout',
          expectedRevision: currentReplicator.revision,
          layout: { ...layout, ...option },
        };
      },
    ));
  }, [clipId, updateMotionLayer]);

  const setOffsetMode = useCallback((mode: 'cumulative' | 'absolute') => {
    updateMotionLayer(clipId, (current) => applyReplicatorOperation(
      current,
      (currentReplicator) => ({
        type: 'set-terminal-transform',
        expectedRevision: currentReplicator.revision,
        terminalTransform: { ...currentReplicator.terminalTransform, mode },
      }),
    ));
  }, [clipId, updateMotionLayer]);

  const setUserLimit = useCallback((userLimit: number) => {
    updateMotionLayer(clipId, (current) => applyReplicatorOperation(
      current,
      (currentReplicator) => ({
        type: 'set-user-limit',
        expectedRevision: currentReplicator.revision,
        userLimit: Math.max(1, Math.min(100000, Math.round(userLimit))),
      }),
    ));
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
            <option value="path">Path</option>
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
        {shape.primitive === 'path' && (
          <>
            <div className="control-row">
              <label className="prop-label">Path</label>
              <span>{shape.path?.vertices.length ?? 0} vertices</span>
              <label>
                <input
                  type="checkbox"
                  aria-label="Close path"
                  checked={shape.path?.closed ?? false}
                  onChange={(event) => setPathClosed(event.target.checked)}
                />
                Closed
              </label>
            </div>
            <NumberRow
              clipId={clipId}
              label="Trim Start"
              property="shape.path.trim.start"
              value={shape.path?.trim?.start ?? 0}
              min={0}
              max={shape.path?.trim?.end ?? 1}
              defaultValue={0}
              onDragStart={handlePathDragStart}
              onDragEnd={handlePathDragEnd}
            />
            <NumberRow
              clipId={clipId}
              label="Trim End"
              property="shape.path.trim.end"
              value={shape.path?.trim?.end ?? 1}
              min={shape.path?.trim?.start ?? 0}
              max={1}
              defaultValue={1}
              onDragStart={handlePathDragStart}
              onDragEnd={handlePathDragEnd}
            />
            <NumberRow
              clipId={clipId}
              label="Trim Offset"
              property="shape.path.trim.offset"
              value={shape.path?.trim?.offset ?? 0}
              min={0}
              max={1}
              defaultValue={0}
              onDragStart={handlePathDragStart}
              onDragEnd={handlePathDragEnd}
            />
            <NumberRow
              clipId={clipId}
              label="Dash Length"
              property="shape.path.dash.length"
              value={shape.path?.dash?.length ?? 0}
              min={0}
              suffix="px"
              defaultValue={0}
              onDragStart={handlePathDragStart}
              onDragEnd={handlePathDragEnd}
            />
            <NumberRow
              clipId={clipId}
              label="Dash Gap"
              property="shape.path.dash.gap"
              value={shape.path?.dash?.gap ?? 0}
              min={0}
              suffix="px"
              defaultValue={0}
              onDragStart={handlePathDragStart}
              onDragEnd={handlePathDragEnd}
            />
            <NumberRow
              clipId={clipId}
              label="Dash Offset"
              property="shape.path.dash.offset"
              value={shape.path?.dash?.offset ?? 0}
              min={0}
              suffix="px"
              defaultValue={0}
              onDragStart={handlePathDragStart}
              onDragEnd={handlePathDragEnd}
            />
          </>
        )}
      </div>

      <MotionAppearanceStackEditor clipId={clipId} />

      <MotionTemplatesSection clipId={clipId} />

      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">Replicator</label>
          <input
            type="checkbox"
            aria-label="Enable Replicator"
            checked={replicator.enabled}
            onChange={(event) => setReplicatorEnabled(event.target.checked)}
          />
          <select
            aria-label="Replicator layout"
            value={replicator.layout.mode}
            onChange={(event) => setReplicatorMode(event.target.value as ReplicatorLayout['mode'])}
            disabled={!replicator.enabled}
          >
            <option value="grid">Grid</option>
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
          </select>
        </div>
        {replicator.enabled && (
          <>
            {replicator.layout.mode === 'grid' && (
              <>
                <NumberRow clipId={clipId} label="Columns" property="replicator.count.x" value={gridLayout.count.columns} min={1} max={10000} defaultValue={3} />
                <NumberRow clipId={clipId} label="Rows" property="replicator.count.y" value={gridLayout.count.rows} min={1} max={10000} defaultValue={3} />
                <NumberRow clipId={clipId} label="Spacing X" property="replicator.spacing.x" value={gridLayout.spacing.x} suffix="px" defaultValue={120} />
                <NumberRow clipId={clipId} label="Spacing Y" property="replicator.spacing.y" value={gridLayout.spacing.y} suffix="px" defaultValue={120} />
                <NumberRow clipId={clipId} label="Pattern X" property="replicator.patternOffset.x" value={gridLayout.patternOffset.x} suffix="px" defaultValue={0} />
                <NumberRow clipId={clipId} label="Pattern Y" property="replicator.patternOffset.y" value={gridLayout.patternOffset.y} suffix="px" defaultValue={0} />
              </>
            )}
            {linearLayout && (
              <>
                <NumberRow clipId={clipId} label="Count" property="replicator.linear.count" value={linearLayout.count} min={1} max={100000} defaultValue={3} />
                <NumberRow clipId={clipId} label="Step X" property="replicator.linear.step.x" value={linearLayout.step.x} suffix="px" defaultValue={120} />
                <NumberRow clipId={clipId} label="Step Y" property="replicator.linear.step.y" value={linearLayout.step.y} suffix="px" defaultValue={0} />
              </>
            )}
            {radialLayout && (
              <>
                <NumberRow clipId={clipId} label="Count" property="replicator.radial.count" value={radialLayout.count} min={1} max={100000} defaultValue={8} />
                <NumberRow clipId={clipId} label="Center X" property="replicator.radial.center.x" value={radialLayout.center.x} suffix="px" defaultValue={0} />
                <NumberRow clipId={clipId} label="Center Y" property="replicator.radial.center.y" value={radialLayout.center.y} suffix="px" defaultValue={0} />
                <NumberRow clipId={clipId} label="Radius" property="replicator.radial.radius" value={radialLayout.radius} min={0} suffix="px" defaultValue={180} />
                <NumberRow clipId={clipId} label="Start" property="replicator.radial.startAngleDegrees" value={radialLayout.startAngleDegrees} suffix="°" defaultValue={0} />
                <NumberRow clipId={clipId} label="End" property="replicator.radial.endAngleDegrees" value={radialLayout.endAngleDegrees} suffix="°" defaultValue={360} />
                <div className="control-row">
                  <label className="prop-label">Sampling</label>
                  <select
                    aria-label="Radial angle sampling"
                    value={radialLayout.angleSampling}
                    onChange={(event) => setRadialOption({
                      angleSampling: event.target.value as 'inclusive-end' | 'exclusive-end',
                    })}
                  >
                    <option value="exclusive-end">Exclusive end</option>
                    <option value="inclusive-end">Inclusive end</option>
                  </select>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="Radial auto orient"
                      checked={radialLayout.autoOrient}
                      onChange={(event) => setRadialOption({ autoOrient: event.target.checked })}
                    />
                    Auto orient
                  </label>
                </div>
              </>
            )}
            <div className="control-row">
              <label className="prop-label">Offset</label>
              <select
                aria-label="Replicator offset mode"
                value={replicator.terminalTransform.mode}
                onChange={(event) => setOffsetMode(event.target.value as 'cumulative' | 'absolute')}
              >
                <option value="cumulative">Cumulative</option>
                <option value="absolute">Absolute</option>
              </select>
            </div>
            <NumberRow clipId={clipId} label="Offset X" property="replicator.offset.position.x" value={replicator.terminalTransform.position.x} suffix="px" defaultValue={0} />
            <NumberRow clipId={clipId} label="Offset Y" property="replicator.offset.position.y" value={replicator.terminalTransform.position.y} suffix="px" defaultValue={0} />
            <NumberRow clipId={clipId} label="Rotation" property="replicator.offset.rotation" value={replicator.terminalTransform.rotationDegrees} suffix="°" defaultValue={0} />
            <NumberRow clipId={clipId} label="Scale X" property="replicator.offset.scale.x" value={replicator.terminalTransform.scale.x} defaultValue={1} />
            <NumberRow clipId={clipId} label="Scale Y" property="replicator.offset.scale.y" value={replicator.terminalTransform.scale.y} defaultValue={1} />
            <div className="labeled-value with-keyframe-toggle">
              <KeyframeToggle
                clipId={clipId}
                property="replicator.offset.opacity"
                value={replicator.terminalTransform.opacity}
              />
              <span className="labeled-value-label">Fade</span>
              <DraggableNumber
                value={Math.round(replicator.terminalTransform.opacity * 100)}
                onChange={(value) => setPropertyValue(clipId, 'replicator.offset.opacity', clamp01(value / 100))}
                min={0}
                max={100}
                suffix="%"
                defaultValue={100}
              />
            </div>
            <div className="labeled-value">
              <span className="labeled-value-label">Instance limit</span>
              <DraggableNumber
                value={replicator.userLimit ?? 10000}
                onChange={setUserLimit}
                min={1}
                max={100000}
                defaultValue={10000}
              />
            </div>
          </>
        )}
      </div>

      <MotionExpressionsSection clipId={clipId} />
      <MotionModifiersSection clipId={clipId} motion={motion} />
    </div>
  );
}

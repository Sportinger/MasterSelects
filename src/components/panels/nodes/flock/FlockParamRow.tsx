import type { MouseEvent, ReactNode } from 'react';
import type { FlockExposedParam, FlockParamValue, FlockVec3 } from '../../../../types/flock';
import { createFlockProperty } from '../../../../types/flock';
import type { Keyframe } from '../../../../types/keyframes';
import type { FlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorTypes';
import { readAnimatedFlockParam } from '../../../../services/flock/flockAnimatedParams';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../stores/timeline/types';
import { hexColorToRgb, normalizeHexColor } from '../../../../utils/colorParam';
import { EditableDraggableNumber as DraggableNumber } from '../../../common/EditableDraggableNumber';
import { KeyframeToggle, MultiKeyframeToggle } from '../../properties/shared';
import type { FlockGraphActions } from './useFlockGraphActions';

export interface FlockParamRowProps {
  clip: TimelineClip;
  nodeId: string;
  paramKey: string;
  descriptor: FlockParamDescriptor;
  value: FlockParamValue;
  exposed: FlockExposedParam | undefined;
  exposeGroup: string;
  keyframes: Keyframe[] | undefined;
  clipLocalTime: number;
  resolveSourceOffset: (clipId: string, clipLocalTime: number) => number;
  actions: FlockGraphActions;
}

function isFlockParamKeyframeable(descriptor: FlockParamDescriptor): boolean {
  return descriptor.animatable && descriptor.invalidation !== 'topology';
}

function decimalsFor(descriptor: FlockParamDescriptor): number {
  if (descriptor.type === 'integer') return 0;
  const step = descriptor.step;
  if (step === undefined) return 2;
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

function sensitivityFor(descriptor: FlockParamDescriptor, value: number): number {
  if (descriptor.min !== undefined && descriptor.max !== undefined && Number.isFinite(descriptor.max - descriptor.min)) {
    return Math.max(0.001, (descriptor.max - descriptor.min) / 200);
  }
  return Math.max(0.01, Math.abs(value) * 0.01);
}

function clampToDescriptor(descriptor: FlockParamDescriptor, value: number): number {
  const clamped = Math.min(descriptor.max ?? Infinity, Math.max(descriptor.min ?? -Infinity, value));
  return descriptor.type === 'integer' ? Math.round(clamped) : clamped;
}

function blurAfterPointer(event: MouseEvent<HTMLElement>): void {
  if (event.detail > 0) event.currentTarget.blur();
}

function hintFor(descriptor: FlockParamDescriptor): string | null {
  if (isFlockParamKeyframeable(descriptor)) return null;
  if (descriptor.invalidation === 'topology' || descriptor.invalidation === 'behavior') return 'resimulates';
  if (descriptor.invalidation === 'derived') return 'rebuilds lines';
  return null;
}

function AssetSelect({ descriptor, value, onChange }: {
  descriptor: FlockParamDescriptor;
  value: string;
  onChange: (value: string) => void;
}) {
  const files = useMediaStore((state) => state.files);
  const clips = useTimelineStore((state) => state.clips);
  const options = descriptor.assetKind === 'audio'
    ? clips.filter((clip) => clip.source?.type === 'audio').map((clip) => ({ id: clip.id, label: clip.name }))
    : files
        .filter((file) => file.type === (descriptor.assetKind === 'image' ? 'image' : 'model'))
        .map((file) => ({ id: file.id, label: file.name }));
  const missing = value !== '' && !options.some((option) => option.id === value);

  return (
    <select className="node-workspace-flock-select" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">None</option>
      {missing && <option value={value}>Missing: {value}</option>}
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  );
}

export function FlockParamRow({
  clip,
  nodeId,
  paramKey,
  descriptor,
  value,
  exposed,
  exposeGroup,
  keyframes,
  clipLocalTime,
  resolveSourceOffset,
  actions,
}: FlockParamRowProps) {
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const isRecording = useTimelineStore((state) => state.isRecording);
  const hasKeyframes = useTimelineStore((state) => state.hasKeyframes);
  const keyframeable = isFlockParamKeyframeable(descriptor);
  const hint = hintFor(descriptor);
  const animated = (component?: 'x' | 'y' | 'z' | 'r' | 'g' | 'b') => readAnimatedFlockParam(
    clip,
    keyframes,
    createFlockProperty(nodeId, paramKey, component),
    clipLocalTime,
    resolveSourceOffset,
  );
  const resetToDefault = () => actions.setParam(nodeId, paramKey, descriptor.default);

  const exposeButton = (
    <button
      type="button"
      className={`node-workspace-flock-expose${exposed ? ' active' : ''}`}
      aria-pressed={!!exposed}
      title={exposed ? 'Remove this control from the clip Properties panel' : 'Show this control in the clip Properties panel'}
      onClick={(event) => {
        blurAfterPointer(event);
        if (exposed) actions.unexposeParam(exposed.id);
        else actions.exposeParam(nodeId, paramKey, descriptor.label, exposeGroup);
      }}
    >
      {exposed ? 'Exposed' : 'Expose'}
    </button>
  );

  const row = (control: ReactNode, toggle: ReactNode = <span className="node-workspace-flock-toggle-spacer" />) => (
    <div
      className="node-workspace-flock-param"
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('input, select, button')) return;
        event.preventDefault();
        resetToDefault();
      }}
      title={descriptor.description}
    >
      {toggle}
      <span className="node-workspace-flock-param-label">
        {descriptor.label}
        {descriptor.unit && <em>{descriptor.unit}</em>}
        {hint && <small className="node-workspace-flock-hint">{hint}</small>}
      </span>
      <span className="node-workspace-flock-param-control">{control}</span>
      {exposeButton}
    </div>
  );

  const numberEditor = (current: number, onChange: (next: number) => void, persistence: string) => (
    <DraggableNumber
      value={current}
      onChange={onChange}
      defaultValue={typeof descriptor.default === 'number' ? descriptor.default : 0}
      decimals={decimalsFor(descriptor)}
      min={descriptor.min}
      max={descriptor.max}
      sensitivity={sensitivityFor(descriptor, current)}
      persistenceKey={persistence}
      onDragStart={() => startBatch('Adjust flock parameter')}
      onDragEnd={() => endBatch()}
    />
  );

  switch (descriptor.type) {
    case 'number':
    case 'integer': {
      const property = createFlockProperty(nodeId, paramKey);
      const base = typeof value === 'number' ? value : Number(descriptor.default) || 0;
      const current = keyframeable ? animated() ?? base : base;
      return row(
        numberEditor(current, (next) => {
          const clamped = clampToDescriptor(descriptor, next);
          if (keyframeable) setPropertyValue(clip.id, property, clamped);
          else actions.setParam(nodeId, paramKey, clamped);
        }, `flock.${clip.id}.${nodeId}.${paramKey}`),
        keyframeable ? <KeyframeToggle clipId={clip.id} property={property} value={current} /> : undefined,
      );
    }
    case 'vec3': {
      const base = (Array.isArray(value) ? value : descriptor.default) as FlockVec3;
      const components = ['x', 'y', 'z'] as const;
      return (
        <div className="node-workspace-flock-vector" title={descriptor.description}>
          <div className="node-workspace-flock-vector-title">
            <span>{descriptor.label}{descriptor.unit && <em>{descriptor.unit}</em>}</span>
            {hint && <small className="node-workspace-flock-hint">{hint}</small>}
            {exposeButton}
          </div>
          {components.map((component, index) => {
            const property = createFlockProperty(nodeId, paramKey, component);
            const current = keyframeable ? animated(component) ?? base[index] : base[index];
            return (
              <div key={component} className="node-workspace-flock-param node-workspace-flock-param-component">
                {keyframeable
                  ? <KeyframeToggle clipId={clip.id} property={property} value={current} />
                  : <span className="node-workspace-flock-toggle-spacer" />}
                <span className="node-workspace-flock-param-label">{component.toUpperCase()}</span>
                <span className="node-workspace-flock-param-control">
                  {numberEditor(current, (next) => {
                    if (keyframeable) {
                      setPropertyValue(clip.id, property, next);
                      return;
                    }
                    const nextVector: FlockVec3 = [base[0], base[1], base[2]];
                    nextVector[index] = next;
                    actions.setParam(nodeId, paramKey, nextVector);
                  }, `flock.${clip.id}.${nodeId}.${paramKey}.${component}`)}
                </span>
              </div>
            );
          })}
        </div>
      );
    }
    case 'color': {
      const fallback = String(descriptor.default);
      const baseHex = normalizeHexColor(value, fallback);
      const baseRgb = hexColorToRgb(baseHex, fallback);
      const channels = [
        { channel: 'r' as const, base: baseRgb.r },
        { channel: 'g' as const, base: baseRgb.g },
        { channel: 'b' as const, base: baseRgb.b },
      ].map(({ channel, base }) => {
        const property = createFlockProperty(nodeId, paramKey, channel);
        return { property, value: Math.round(animated(channel) ?? base) };
      });
      const currentHex = `#${channels.map(({ value: channelValue }) => Math.max(0, Math.min(255, channelValue)).toString(16).padStart(2, '0')).join('')}`;
      const keyed = channels.some(({ property }) => isRecording(clip.id, property) || hasKeyframes(clip.id, property));
      return row(
        <span className="node-workspace-flock-color">
          <input
            type="color"
            value={currentHex}
            aria-label={descriptor.label}
            onChange={(event) => {
              const normalized = normalizeHexColor(event.target.value, currentHex);
              if (!keyed) {
                actions.setParam(nodeId, paramKey, normalized);
                return;
              }
              const next = hexColorToRgb(normalized, currentHex);
              startBatch('Adjust flock color');
              try {
                setPropertyValue(clip.id, channels[0].property, next.r);
                setPropertyValue(clip.id, channels[1].property, next.g);
                setPropertyValue(clip.id, channels[2].property, next.b);
              } finally {
                endBatch();
              }
            }}
          />
          <code>{currentHex}</code>
        </span>,
        <MultiKeyframeToggle
          clipId={clip.id}
          entries={channels}
          dragId={`${clip.id}:flock:${nodeId}:${paramKey}:color`}
          title="Add color keyframes"
        />,
      );
    }
    case 'enum':
      return row(
        <select
          className="node-workspace-flock-select"
          value={String(value)}
          onChange={(event) => actions.setParam(nodeId, paramKey, event.target.value)}
        >
          {descriptor.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>,
      );
    case 'boolean':
      return row(
        <input
          type="checkbox"
          className="node-workspace-flock-checkbox"
          checked={value === true}
          aria-label={descriptor.label}
          onChange={(event) => actions.setParam(nodeId, paramKey, event.target.checked)}
        />,
      );
    case 'asset':
      return row(
        <AssetSelect
          descriptor={descriptor}
          value={typeof value === 'string' ? value : ''}
          onChange={(next) => actions.setParam(nodeId, paramKey, next)}
        />,
      );
    default:
      return row(<code>{String(value)}</code>);
  }
}

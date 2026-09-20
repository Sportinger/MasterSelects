import type { ReactNode } from 'react';
import type { FlockExposedParam, FlockParamValue, FlockVec3 } from '../../../../types/flock';
import { createFlockProperty } from '../../../../types/flock';
import type { Keyframe } from '../../../../types/keyframes';
import type { FlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorTypes';
import { readAnimatedFlockParam } from '../../../../services/flock/flockAnimatedParams';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../types/timeline';
import { hexColorToRgb, normalizeHexColor } from '../../../../utils/colorParam';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorIconButton, ResolveResetIcon, ResolveLinkIcon, ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
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

function clampToDescriptor(descriptor: FlockParamDescriptor, value: number): number {
  const clamped = Math.min(descriptor.max ?? Infinity, Math.max(descriptor.min ?? -Infinity, value));
  return descriptor.type === 'integer' ? Math.round(clamped) : clamped;
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

  return <InspectorSelect ariaLabel={descriptor.label} value={value} onChange={onChange}
    options={[{ value: '', label: 'None' }, ...(missing ? [{ value, label: `Missing: ${value}` }] : []),
      ...options.map(option => ({ value: option.id, label: option.label }))]} />;

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
    <ResolveInspectorIconButton
      className="node-workspace-flock-expose"
      active={!!exposed}
      ariaLabel={`${exposed ? 'Unexpose' : 'Expose'} ${descriptor.label}`}
      title={exposed ? 'Remove this control from the clip Properties panel' : 'Show this control in the clip Properties panel'}
      onClick={() => {
        if (exposed) actions.unexposeParam(exposed.id);
        else actions.exposeParam(nodeId, paramKey, descriptor.label, exposeGroup);
      }}
    >
      <ResolveLinkIcon />
    </ResolveInspectorIconButton>
  );

  const row = (control: ReactNode, toggle?: ReactNode) => (
    <ResolveInspectorRow className="resolve-inspector-row--extra-action" label={descriptor.label} title={[descriptor.description, hint].filter(Boolean).join(' - ')}
      actions={<>{exposeButton}{toggle}<ResolveInspectorIconButton ariaLabel={`Reset ${descriptor.label}`}
        className="resolve-inspector-reset-button" onClick={resetToDefault}><ResolveResetIcon /></ResolveInspectorIconButton></>}>
      {control}
    </ResolveInspectorRow>
  );
  const numberRow = (label: string, current: number, fallback: number, onChange: (next: number) => void,
    persistenceKey: string, toggle?: ReactNode, expose = true) => (
    <ResolveInspectorNumberRow label={label} ariaLabel={`${descriptor.label}${label === descriptor.label ? '' : ` ${label}`}`}
      value={current} defaultValue={fallback} min={descriptor.min ?? -100} max={descriptor.max ?? 100}
      hardMin={descriptor.min} hardMax={descriptor.max} step={descriptor.type === 'integer' ? 1 : descriptor.step ?? 0.01}
      persistenceKey={persistenceKey} onChange={next => onChange(clampToDescriptor(descriptor, next))}
      keyframeToggle={toggle} actions={expose ? exposeButton : undefined} />
  );

  switch (descriptor.type) {
    case 'number':
    case 'integer': {
      const property = createFlockProperty(nodeId, paramKey);
      const base = typeof value === 'number' ? value : Number(descriptor.default) || 0;
      const current = keyframeable ? animated() ?? base : base;
      return numberRow(descriptor.label, current, Number(descriptor.default), (next) => {
          const clamped = clampToDescriptor(descriptor, next);
          if (keyframeable) setPropertyValue(clip.id, property, clamped);
          else actions.setParam(nodeId, paramKey, clamped);
        }, `flock.${clip.id}.${nodeId}.${paramKey}`,
        keyframeable ? <KeyframeToggle clipId={clip.id} property={property} value={current} /> : undefined,
      );
    }
    case 'vec3': {
      const base = (Array.isArray(value) ? value : descriptor.default) as FlockVec3;
      const components = ['x', 'y', 'z'] as const;
      return <ResolveInspectorSection title={descriptor.label} headerActions={exposeButton}>
        {components.map((component, index) => {
          const property = createFlockProperty(nodeId, paramKey, component);
          const current = keyframeable ? animated(component) ?? base[index] : base[index];
          const fallback = Array.isArray(descriptor.default) ? descriptor.default[index] : 0;
          return <div key={component}>{numberRow(component.toUpperCase(), current, fallback, next => {
            if (keyframeable) setPropertyValue(clip.id, property, next);
            else {
              const vector: FlockVec3 = [...base]; vector[index] = next;
              actions.setParam(nodeId, paramKey, vector);
            }
          }, `flock.${clip.id}.${nodeId}.${paramKey}.${component}`,
          keyframeable ? <KeyframeToggle clipId={clip.id} property={property} value={current} /> : undefined, false)}</div>;
        })}
      </ResolveInspectorSection>;
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
      return row(<InspectorSelect ariaLabel={descriptor.label} value={String(value)}
        options={descriptor.options ?? []} onChange={next => actions.setParam(nodeId, paramKey, next)} />);
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

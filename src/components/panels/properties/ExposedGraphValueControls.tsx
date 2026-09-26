import { useTimelineStore } from '../../../stores/timeline';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { exposedGraphValues } from '../../../services/operators/exposedGraphValues';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { EffectKeyframeToggle } from './shared';

const EMPTY_KEYS: Keyframe[] = [];

/** Value nodes the user exposed from the node graph; keyframes drive the node output. */
export function ExposedGraphValueControls({ clipId, effect }: {
  clipId: string;
  effect: { id: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };
}) {
  const time = useTimelineStore(state => {
    const clip = state.clips.find(item => item.id === clipId);
    return clip ? state.playheadPosition - clip.startTime : 0;
  });
  const keys = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYS);
  const values = exposedGraphValues(effect.operatorGraph);
  if (!values.length) return null;
  return <ResolveInspectorSection title="Graph values">
    {values.map(exposed => {
      const property = `effect.${effect.id}.${exposed.key}` as AnimatableProperty;
      const base = Number(effect.params[exposed.key] ?? 0);
      const value = interpolateKeyframes(keys, property, time, Number.isFinite(base) ? base : 0);
      return <ResolveInspectorNumberRow key={exposed.nodeId} label={exposed.label} ariaLabel={exposed.label}
        value={value} defaultValue={base} min={Math.min(exposed.min, value)} max={Math.max(exposed.max, value)} step={exposed.step}
        decimals={exposed.integer ? 0 : undefined}
        onChange={next => useTimelineStore.getState().setPropertyValue(clipId, property, exposed.integer ? Math.trunc(next) : next)}
        persistenceKey={`effect.${clipId}.${effect.id}.${exposed.key}`}
        keyframeToggle={<EffectKeyframeToggle clipId={clipId} effectId={effect.id} paramName={exposed.key} value={value} />} />;
    })}
  </ResolveInspectorSection>;
}

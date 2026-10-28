import { useTimelineStore } from '../../../stores/timeline';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { exposedGraphValueSections } from '../../../services/operators/exposedGraphValues';
import { getEffect } from '../../../effects';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { EffectKeyframeToggle } from './shared';

const EMPTY_KEYS: Keyframe[] = [];

/**
 * Value nodes the user exposed from the node graph, one section per node group; keyframes drive the node
 * output. A value that is also a parameter of the effect's own card (Weave's Reveal) shows there once.
 */
export function ExposedGraphValueControls({ clipId, effect }: {
  clipId: string;
  effect: { id: string; type?: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };
}) {
  const card = getEffect(effect.type ?? '')?.params ?? {};
  const sections = exposedGraphValueSections(effect.operatorGraph)
    .map(section => ({ ...section, values: section.values.filter(value => !(value.key in card)) }))
    .filter(section => section.values.length);
  const keys = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYS);
  // Only keyed exposed values follow the playhead; otherwise every effect card re-rendered on every tick.
  const followsPlayhead = sections.length > 0 && keys.length > 0;
  const time = useTimelineStore(state => {
    if (!followsPlayhead) return 0;
    const clip = state.clips.find(item => item.id === clipId);
    return clip ? state.playheadPosition - clip.startTime : 0;
  });
  if (!sections.length) return null;
  return <>{sections.map(section => <ResolveInspectorSection key={section.groupId ?? ''} title={section.label} bypassGroupId={section.groupId}>
    {section.values.map(exposed => {
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
  </ResolveInspectorSection>)}</>;
}

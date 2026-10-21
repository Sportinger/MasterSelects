import { useMemo, useSyncExternalStore } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { timeStack } from '../../../effects/time/time-stack';
import { TIME_STACK_DEFAULT_DECAY, timeStackDecay, timeStackSettings } from '../../../effects/time/time-stack/settings';
import { getTemporalStatus, subscribeTemporalStatus } from '../../../effects/time/temporalResourcePreparation';
import { effectOperatorGraph } from '../../../services/operators/effectGraphOwner';
import { timeStackGraphReadsDecay } from '../../../services/operators/timeStackEffectGraph';
import { useTimelineStore } from '../../../stores/timeline';
import { BLEND_MODE_GROUPS, formatBlendModeName } from './sharedConstants';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { KeyframeToggle } from './shared';

const blendGroups = BLEND_MODE_GROUPS.map(group => ({ label: group.label, options: group.modes.map(value => ({ value, label: formatBlendModeName(value) })) }));

function TimeStackStatus({ effectId }: { effectId: string }) {
  const status = useSyncExternalStore(subscribeTemporalStatus, () => getTemporalStatus(effectId));
  return status ? <p className="tracking-panel-status" role="status">{status}</p> : null;
}

export function TimeStackControls({ params, onChange, effectInstanceId, clipId, operatorGraph }: EffectControlProps & { operatorGraph?: EffectOperatorGraph }) {
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const settings = timeStackSettings(params);
  const decay = timeStackDecay(params);
  const readsDecay = useMemo(() => {
    try { return timeStackGraphReadsDecay(effectOperatorGraph({ type: 'time-stack', params: {}, operatorGraph }, { inspectionOnly: true })); } catch { return true; }
  }, [operatorGraph]);
  const change = (key: string, value: number | string) => onChange({ ...params, [key]: value });
  const decayProperty = `effect.${effectInstanceId}.decay` as AnimatableProperty;
  const decayValue = typeof params.decay === 'number' && Number.isFinite(params.decay) ? params.decay : decay.decay;
  // Sequence Blend draws the current frame first and each older copy over it: modes that cover what is below
  // (Normal) bury the present under the faded copies instead of trailing them behind it.
  const blendMode = String(params.blendMode ?? timeStack.params.blendMode.default);
  return <ResolveInspectorSection title="Time Stack" indicator="none">
    <ResolveInspectorNumberRow label="Instances" value={settings.count} defaultValue={20} min={1} max={32}
      step={1} onChange={value => change('count', Math.trunc(value))} onReset={() => change('count', 20)} />
    <ResolveInspectorNumberRow label="Time offset" value={settings.offset} defaultValue={0.1} min={0} max={10}
      step={0.01} suffix="s" onChange={value => change('offset', value)} onReset={() => change('offset', 0.1)} />
    <ResolveInspectorNumberRow label="Decay" value={decayValue} defaultValue={TIME_STACK_DEFAULT_DECAY} min={0} max={1} step={0.01} decimals={2}
      keyframeToggle={clipId && effectInstanceId ? <KeyframeToggle clipId={clipId} property={decayProperty} value={decayValue} /> : undefined}
      onChange={value => clipId && effectInstanceId ? setPropertyValue(clipId, decayProperty, value) : change('decay', value)} />
    {(['blendMode', 'previewSize', 'memoryMiB'] as const).map(key => <ResolveInspectorRow key={key} label={timeStack.params[key].label}>
      <InspectorSelect wheelSelection ariaLabel={timeStack.params[key].label} value={String(params[key] ?? timeStack.params[key].default)}
        groups={key === 'blendMode' ? blendGroups : undefined} options={timeStack.params[key].options!} onChange={value => change(key, value)} />
    </ResolveInspectorRow>)}
    <p className="tracking-panel-status">{settings.count} instances span {((settings.count - 1) * settings.offset).toFixed(2)} s. Each older instance keeps {Math.round(decay.decay * 100)} % of the previous one's opacity. Delayed instances start progressively. Export uses original frames.</p>
    {decay.clamped && <p className="tracking-panel-status" role="status">Decay is outside 0–1 and is used as {decay.decay.toFixed(2)}.</p>}
    {decay.invalid && <p className="tracking-panel-status" role="status">Decay is not a number and is used as {decay.decay.toFixed(2)}.</p>}
    {readsDecay && blendMode === 'normal' && decay.decay < 1 && <p className="tracking-panel-status" role="status">In Normal each older copy is drawn
      over the newer ones, so the current frame ends up underneath. For an echo trail behind the subject use Lighten, Screen or Add.</p>}
    {!readsDecay && <p className="tracking-panel-status" role="status">This node graph was edited before Decay existed, so Decay has no effect. Re-add Time Stack to use it.</p>}
    <TimeStackStatus effectId={effectInstanceId ?? ''} />
  </ResolveInspectorSection>;
}

import { useSyncExternalStore } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import { timeStack } from '../../../effects/time/time-stack';
import { timeStackSettings } from '../../../effects/time/time-stack/settings';
import { getTemporalStatus, subscribeTemporalStatus } from '../../../effects/time/temporalResourcePreparation';
import { BLEND_MODE_GROUPS, formatBlendModeName } from './sharedConstants';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';

const blendGroups = BLEND_MODE_GROUPS.map(group => ({ label: group.label, options: group.modes.map(value => ({ value, label: formatBlendModeName(value) })) }));

function TimeStackStatus({ effectId }: { effectId: string }) {
  const status = useSyncExternalStore(subscribeTemporalStatus, () => getTemporalStatus(effectId));
  return status ? <p className="tracking-panel-status" role="status">{status}</p> : null;
}

export function TimeStackControls({ params, onChange, effectInstanceId }: EffectControlProps) {
  const settings = timeStackSettings(params);
  const change = (key: string, value: number | string) => onChange({ ...params, [key]: value });
  return <ResolveInspectorSection title="Time Stack" indicator="none">
    <ResolveInspectorNumberRow label="Instances" value={settings.count} defaultValue={20} min={1} max={32}
      step={1} onChange={value => change('count', Math.trunc(value))} onReset={() => change('count', 20)} />
    <ResolveInspectorNumberRow label="Time offset" value={settings.offset} defaultValue={0.1} min={0} max={10}
      step={0.01} suffix="s" onChange={value => change('offset', value)} onReset={() => change('offset', 0.1)} />
    {(['blendMode', 'previewSize', 'memoryMiB'] as const).map(key => <ResolveInspectorRow key={key} label={timeStack.params[key].label}>
      <InspectorSelect wheelSelection ariaLabel={timeStack.params[key].label} value={String(params[key] ?? timeStack.params[key].default)}
        groups={key === 'blendMode' ? blendGroups : undefined} options={timeStack.params[key].options!} onChange={value => change(key, value)} />
    </ResolveInspectorRow>)}
    <p className="tracking-panel-status">{settings.count} instances span {((settings.count - 1) * settings.offset).toFixed(2)} s. Delayed instances start progressively. Export uses original frames.</p>
    <TimeStackStatus effectId={effectInstanceId ?? ''} />
  </ResolveInspectorSection>;
}

import { useMemo } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { propertyRegistry } from '../../../services/properties';
import type { TextClipProperties } from '../../../types/text';
import { InspectorSelect, type InspectorSelectGroup } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';
import { TextAnimatedNumberRow } from './TextAnimatedNumberRow';

const NO_LINK = '';

/** Value that `{value}` tokens print, either keyframed here or following another clip's property. */
export function TextValueControls({ clipId, textProperties, disabled = false }: {
  clipId: string; textProperties: TextClipProperties; disabled?: boolean;
}) {
  const link = textProperties.valueLink;
  const clips = useTimelineStore(state => state.clips);
  const updateTextProperties = useTimelineStore(state => state.updateTextProperties);
  const clipOptions = useMemo(() => [{ label: 'None (own keyframes)', value: NO_LINK },
    ...clips.filter(clip => clip.id !== clipId).map(clip => ({ label: clip.name || clip.id, value: clip.id }))], [clips, clipId]);
  const target = link ? clips.find(clip => clip.id === link.clipId) : undefined;
  const propertyGroups = useMemo<InspectorSelectGroup[]>(() => {
    if (!target) return [];
    const groups = new Map<string, { label: string; value: string }[]>();
    for (const descriptor of propertyRegistry.getAllDescriptors(target)) {
      if (!descriptor.animatable || descriptor.valueType !== 'number') continue;
      groups.set(descriptor.group, [...(groups.get(descriptor.group) ?? []), { label: descriptor.label, value: descriptor.path }]);
    }
    return [...groups].map(([label, options]) => ({ label, options }));
  }, [target]);
  const setLink = (next: TextClipProperties['valueLink']) => updateTextProperties(clipId, { valueLink: next });
  return <>
    {!link && <TextAnimatedNumberRow clipId={clipId} parameter="value" baseValue={textProperties.value ?? 0}
      defaultValue={0} disabled={disabled} />}
    <ResolveInspectorRow label="Follow" disabled={disabled}>
      <InspectorSelect ariaLabel="Value follows clip" disabled={disabled} value={link?.clipId ?? NO_LINK}
        options={link && !target ? [...clipOptions, { label: 'Missing clip', value: link.clipId, disabled: true }] : clipOptions}
        onReset={() => setLink(undefined)}
        onChange={value => {
          if (value === NO_LINK) { setLink(undefined); return; }
          const next = clips.find(clip => clip.id === value);
          const hasSpeed = next && propertyRegistry.getDescriptor('speed', next);
          setLink({ clipId: value, property: link?.property && next && propertyRegistry.getDescriptor(link.property, next)
            ? link.property : hasSpeed ? 'speed' : 'opacity' });
        }} />
    </ResolveInspectorRow>
    {link && target && <ResolveInspectorRow label="Property" disabled={disabled}>
      <InspectorSelect ariaLabel="Followed property" disabled={disabled} value={link.property} groups={propertyGroups}
        onChange={property => setLink({ clipId: link.clipId, property })} />
    </ResolveInspectorRow>}
    <div className="tt-token-hint">{'{value}  {value:1}  {value*100:0}%  {time:2}'}</div>
  </>;
}

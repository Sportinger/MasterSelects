import { useEffect, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { findClipOperatorEffect } from '../../../../services/operators/clipOperatorGraphOwner';
import type { TimelineClip } from '../../../../types/timeline';
import type { EffectOperatorGraph } from '../../../../types/operatorGraph';
import { useInspectorEffectGraph } from './useInspectorEffectGraph';
import { sceneGraphForClip } from '../../../../services/operators/sceneGraph';
import { editEffectGraph } from '../../../../services/operators/effectGraphEditing';
import { editSceneGraph } from '../../../../services/operators/sceneGraphEditing';
import { ungroupOperators } from '../../../../services/operators/operatorGroups';
import { operatorGroupBypassRoutes, operatorGroupRenderer } from '../../../../services/operators/operatorGroupBypass';
import { operatorEnabled } from '../../../../services/operators/effectGraph';
import { setEffectGroupEnabled } from '../../../../services/operators/effectGroupBypassEditing';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { ResolveInspectorSection, ResolveInspectorRow, ResolveInspectorIconButton } from '../../properties/resolveInspector/ResolveInspectorPrimitives';

export function OperatorGroupParameters({ clip, groupId, effectId }: { clip: TimelineClip; groupId: string; effectId?: string }) {
  const clips = useTimelineStore(state => state.clips);
  const effect = effectId ? findClipOperatorEffect(clip, effectId, clips) : undefined;
  const prepared = useInspectorEffectGraph(effect);
  const graph = effect ? prepared.graph : sceneGraphForClip(clip).graph;
  const id = groupId.split('/').at(-1)!, group = graph?.groups?.find(g => g.id === id);
  const [name, setName] = useState(group?.label ?? ''), [message, setMessage] = useState('');
  useEffect(() => { setName(group?.label ?? ''); }, [group?.label, groupId]);
  if (prepared.error) return <p role="alert">{prepared.error}</p>;
  if (!graph) return <p role="status">Preparing graph controls…</p>;
  if (!group) return null;
  const renderer = operatorGroupRenderer(graph, id);
  const canBypass = !!effectId && (!!renderer || !!operatorGroupBypassRoutes(graph, group));
  const edit = (fn: (g: EffectOperatorGraph) => void) => {
    try { if (effectId) editEffectGraph(clip.id, effectId, 'Edit node group', fn); else editSceneGraph(clip.id, 'Edit node group', d => fn(d.graph)); setMessage(''); }
    catch (error) { setMessage(String(error)); }
  };
  return <div className="operator-parameters">
    <ResolveInspectorSection title={group.label}
      enabled={canBypass ? (renderer ? operatorEnabled(renderer, effect!.params) : !group.bypassed) : undefined}
      onEnabledChange={canBypass ? enabled => {
        try { setEffectGroupEnabled(clip.id, effectId!, id, enabled); setMessage(''); }
        catch (error) { setMessage(String(error)); }
      } : undefined}>
      {group.composition && <p className="face-cable-hint">Shared definition, revision {group.composition.instance.operatorVersion ?? 1}. Editing its processing steps or name creates a local group; other instances keep their definition.</p>}
      <ResolveInspectorRow label="Name"><input className="operator-group-name" aria-label="Node group name" value={name} maxLength={80}
        onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== group.label) edit(g => { g.groups!.find(v => v.id === id)!.label = name.trim(); }); }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }} /></ResolveInspectorRow>
      <ResolveInspectorRow label="Parent"><InspectorSelect ariaLabel="Parent node group" value={group.parentId ?? ''} options={[{ value: '', label: 'Top level' },
        ...(graph.groups ?? []).filter(g => g.id !== id).map(g => ({ value: g.id, label: g.label }))]}
        onChange={parentId => edit(g => { g.groups!.find(v => v.id === id)!.parentId = parentId || undefined; })} /></ResolveInspectorRow>
      <ResolveInspectorRow label="Ungroup"><ResolveInspectorIconButton ariaLabel="Ungroup nodes" title="Remove the group and retain every processing node" onClick={() => edit(g => ungroupOperators(g, id))}>↗</ResolveInspectorIconButton></ResolveInspectorRow>
      <p className="face-cable-hint">Expand using the arrow beside the node title. Select nodes and press Ctrl+G to create another group inside this one. Grouping keeps every connection and saved artifact.</p>
    </ResolveInspectorSection>
    {message && <p role="alert">{message}</p>}
  </div>;
}

import { operatorEnabled } from './effectGraph';
import { editEffectGraph } from './effectGraphEditing';
import { operatorGroupBypassRoutes, operatorGroupRenderer } from './operatorGroupBypass';

export function setEffectGroupEnabled(clipId: string, effectId: string, groupId: string, enabled: boolean) {
  changeEffectGroupEnabled(clipId, effectId, groupId, enabled);
}

export function toggleEffectGroupEnabled(clipId: string, effectId: string, groupId: string) {
  changeEffectGroupEnabled(clipId, effectId, groupId);
}

function changeEffectGroupEnabled(clipId: string, effectId: string, groupId: string, requested?: boolean) {
  editEffectGraph(clipId, effectId, requested === undefined ? 'Toggle node group' : requested ? 'Enable node group' : 'Bypass node group', (graph, params) => {
    const group = graph.groups?.find(group => group.id === groupId);
    if (!group) throw new Error('Node group is unavailable.');
    const renderer = operatorGroupRenderer(graph, groupId);
    const enabled = requested ?? (renderer ? !operatorEnabled(renderer, params) : group.bypassed === true);
    if (renderer) {
      if (renderer.enabled) { params[renderer.enabled] = enabled; renderer.bypassed = false; }
      else renderer.bypassed = !enabled;
    } else {
      if (!operatorGroupBypassRoutes(graph, group)) throw new Error('This group has no unambiguous bypass boundary.');
      group.bypassed = !enabled;
    }
  });
}

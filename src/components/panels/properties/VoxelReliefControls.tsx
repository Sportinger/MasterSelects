import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { useNodeWorkspaceNavigation } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { voxelOperatorGraph } from '../../../services/operators/voxelGraph';
import { getEffectOperator } from '../../../services/operators/operatorRegistry';
import { OperatorParameters } from '../nodes/workspace/OperatorParameters';

/** The form and node inspector edit the same connected operator bindings. */
export function VoxelReliefControls({ clipId, effectId }: { clipId: string; effectId: string }) {
  const clip = useTimelineStore(state => state.clips.find(value => value.id === clipId));
  const effect = clip?.effects.find(value => value.id === effectId);
  if (!clip || !effect) return null;
  let graph;
  try { graph = voxelOperatorGraph(effect.params); } catch (error) { return <p role="alert">{String(error)}</p>; }
  return <div className="voxel-relief-controls">
    <button type="button" className="node-workspace-primary-action" onClick={event => {
      if (event.detail > 0) event.currentTarget.blur();
      useNodeWorkspaceNavigation.getState().requestView(clipId, `effect:${effectId}`);
      useDockStore.getState().activatePanelType('node-workspace');
    }}>Open Nodes</button>
    {graph.nodes.filter(node => getEffectOperator(node.operator)?.parameters.length).map(node =>
      <OperatorParameters key={node.id} clip={clip} effectId={effectId} nodeId={node.id} />)}
  </div>;
}

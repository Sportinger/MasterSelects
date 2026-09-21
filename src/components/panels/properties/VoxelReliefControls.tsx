import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { requestNodeWorkspaceView } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { effectOperatorGraph } from '../../../services/operators/effectGraphOwner';
import { getEffectOperator } from '../../../services/operators/operatorRegistry';
import { OperatorParameters } from '../nodes/workspace/OperatorParameters';

/** The form and node inspector edit the same connected operator bindings. */
export function VoxelReliefControls({ clipId, effectId }: { clipId: string; effectId: string }) {
  const activatePanelType = useDockStore(state => state.activatePanelType);
  const clip = useTimelineStore(state => state.clips.find(value => value.id === clipId));
  const effect = clip?.effects.find(value => value.id === effectId);
  if (!clip || !effect) return null;
  let graph;
  try { graph = effectOperatorGraph(effect); } catch (error) { return <p role="alert">{String(error)}</p>; }
  return <div className="voxel-relief-controls">
    <button type="button" className="node-workspace-primary-action" onClick={event => {
      if (event.detail > 0) event.currentTarget.blur();
      requestNodeWorkspaceView(clipId, `effect:${effectId}`);
      activatePanelType('node-workspace');
    }}>Open Nodes</button>
    {graph.nodes.filter(node => getEffectOperator(node.operator)?.parameters.length).map(node =>
      <OperatorParameters key={node.id} clip={clip} effectId={effectId} nodeId={node.id} />)}
  </div>;
}

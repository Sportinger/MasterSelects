import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { requestNodeWorkspaceView } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { OperatorParameters } from '../nodes/workspace/OperatorParameters';
import { effectOperatorGraph } from '../../../services/operators/effectGraphOwner';

export function SplatExplorationControls({ clipId, effectId }: { clipId: string; effectId: string }) {
  const clip = useTimelineStore(s => s.clips.find(c => c.id === clipId));
  const activate = useDockStore(s => s.activatePanelType);
  const effect = clip?.effects.find(e => e.id === effectId);
  if (!clip || !effect) return null;
  if (clip.source?.type !== 'gaussian-splat') return <p className="face-cable-hint">Add this effect to a Gaussian splat clip.</p>;
  let graph;
  try { graph = effectOperatorGraph(effect); } catch (error) { return <p role="alert">{String(error)}</p>; }
  return <div>
    <button type="button" className="node-workspace-primary-action" onClick={event => {
      if (event.detail > 0) event.currentTarget.blur();
      requestNodeWorkspaceView(clipId, `effect:${effectId}`); activate('node-workspace');
    }}>Open Nodes</button>
    <p className="face-cable-hint">Original splats, rays, particles and reconstructed wireframe share one editable graph. All branches use the scene camera.</p>
    {graph.nodes.filter(n => ['splat.scale', 'splat.color', 'splat.particles', 'splat.surface', 'material.wireframe', 'splat.render'].includes(n.operator)).map(n =>
      <OperatorParameters key={n.id} clip={clip} effectId={effectId} nodeId={n.id} />)}
  </div>;
}

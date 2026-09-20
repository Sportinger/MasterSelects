import type { NodeGraphNode, TimelineClip } from '../../../../types';
import { useTimelineStore } from '../../../../stores/timeline';
import { TransformTab } from '../../properties/TransformTab';
import { LightTab } from '../../properties/LightTab';
import { Model3DTab } from '../../properties/Model3DTab';
import { GaussianSplatTab } from '../../properties/GaussianSplatTab';
import { SplatEffectorTab } from '../../properties/SplatEffectorTab';
import { FaceCableControls } from '../../properties/FaceCableControls';
import { OperatorParameters } from './OperatorParameters';
import { ResolveInspectorRow, ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../../../stores/timeline/exclusiveMutationLease';

export function SceneNodeParameters({ node, owner }: { node: NodeGraphNode; owner: TimelineClip }) {
  const binding = node.binding?.kind === 'scene-node' ? node.binding : undefined;
  const target = useTimelineStore(s => s.clips.find(c => c.id === binding?.clipId)) ?? owner;
  if (!binding) return null;
  const cable = target.effects.find(e => e.type === 'face-cables' && e.enabled && e.params.scene3D);
  const setWireframe = (wireframe: boolean) => {
    assertExclusiveTimelineMutationAllowed();
    const state = useTimelineStore.getState();
    if (state.isExporting || state.tracks.find(t => t.id === target.trackId)?.locked) return;
    startBatch('Set 3D wireframe');
    try { state.updateClip(target.id, { wireframe }); state.invalidateCache(); } finally { endBatch(); }
  };
  return <div className="operator-parameters" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button,select,input[type="checkbox"]')?.blur();
  }}>
    {target.id !== owner.id && <p className="face-cable-hint">Scene reference: {target.name}. Changes also update that clip's Properties.</p>}
    {(binding.role === 'transform' || binding.role === 'camera') && <TransformTab clipId={target.id} transform={target.transform} is3D speed={target.speed} cameraSettings={target.source?.cameraSettings} />}
    {binding.role === 'light' && <><LightTab clipId={target.id} /><TransformTab clipId={target.id} transform={target.transform} is3D /></>}
    {binding.role === 'splat-effector' && <SplatEffectorTab clipId={target.id} />}
    {binding.role === 'depth' && binding.effectId && <OperatorParameters clip={target} effectId={binding.effectId} nodeId="depth" />}
    {binding.role === 'geometry' && <ResolveInspectorSection title={node.label}>
      <p className="face-cable-hint">{cable ? 'Face mesh, cables and scene depth use the saved bake. Rebake after geometry or physics changes.'
        : `Geometry comes from this clip's ${target.source?.type ?? 'image'} source.`}</p>
      {target.source?.type === 'model' && <ResolveInspectorRow label="Wireframe"><input aria-label="3D wireframe" type="checkbox" checked={target.wireframe ?? false} onChange={e => setWireframe(e.target.checked)} /></ResolveInspectorRow>}
    </ResolveInspectorSection>}
    {(binding.role === 'geometry' || binding.role === 'material') && target.source?.type === 'gaussian-splat' && <GaussianSplatTab clipId={target.id} />}
    {binding.role === 'material' && (target.source?.type === 'model' ? <Model3DTab clipId={target.id} />
      : cable ? <FaceCableControls clipId={target.id} effectId={cable.id} scope="render" />
      : <p className="face-cable-hint">The connected clip image supplies the surface texture. Image effects and color controls remain in the clip graph.</p>)}
    {binding.role === 'render' && <ResolveInspectorSection title="3D scene">
      <p className="face-cable-hint">Geometry, depth, camera and lights feed the shared 3D renderer. Camera and light contributions follow their timeline ranges and track visibility. Select their nodes to edit them.</p>
      <p className="face-cable-hint">Effects after this node process the rendered image. With several visible 3D objects, scene-wide post effects belong on a nested composition.</p>
    </ResolveInspectorSection>}
  </div>;
}

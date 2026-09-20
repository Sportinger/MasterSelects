import type { NodeGraphPortMetadata } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import { landmarkRuntime } from '../landmarkTracking/landmarkRuntime';
import { faceTrackKey } from '../landmarkTracking/preciseFaceSampling';
import { sourceArtifactPorts, sourceArtifactPortId } from '../nodeGraph/sourceArtifactPorts';
import { editEffectGraph } from './effectGraphEditing';
import { connectEffectGraph } from './effectGraph';
import { getEffectOperator } from './operatorRegistry';
import { sourceArtifactOperator } from './sourceArtifactOperators';

export function connectSourceArtifact(clipId: string, artifact: NonNullable<NodeGraphPortMetadata['sourceArtifact']>,
  target: NonNullable<NodeGraphPortMetadata['artifactTarget']>) {
  const clip = useTimelineStore.getState().clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Source clip is unavailable.');
  const series = landmarkRuntime.getSeries(faceTrackKey(clip.id));
  const ready = Boolean(series?.faceTracking && series.sourceId === (clip.source?.mediaFileId ?? clip.mediaFileId ?? clip.id));
  const port = sourceArtifactPorts(clip, ready).find(p => p.id === sourceArtifactPortId(artifact.kind, artifact.effectId));
  if (!port?.metadata?.available) throw new Error(artifact.kind === 'face-landmarks' ? 'Track this face precisely in Properties > Tracking first.' : 'Bake scene depth first.');
  if (port.metadata.stale) throw new Error('Saved depth no longer matches this source, timing or transform. Bake fresh depth first.');
  if (artifact.kind === 'scene-depth' && artifact.effectId !== target.effectId) throw new Error('This saved scene depth belongs to another cable bake. Connect it within its owning effect.');
  const operator = sourceArtifactOperator(artifact.kind);
  editEffectGraph(clipId, target.effectId, 'Connect source artifact', (graph, params) => {
    let node = graph.nodes.find(n => n.operator === operator);
    if (!node) {
      let id = artifact.kind === 'face-landmarks' ? 'saved-landmarks' : 'saved-depth';
      while (graph.nodes.some(n => n.id === id)) id += '-ref';
      node = { id, operator, bindings: {}, ...(artifact.kind === 'scene-depth' ? { enabled: 'sceneDepth', enabledDefault: false } : {}) };
      graph.nodes.push(node); graph.layout[id] = { x: 0, y: 680 };
    }
    if (artifact.kind === 'scene-depth') params.sceneDepth = true;
    graph.edges = connectEffectGraph(graph, { id: `${node.id}-${target.nodeId}-${target.portId}`,
      from: node.id, output: getEffectOperator(operator)!.outputs[0].id, to: target.nodeId, input: target.portId }).edges;
  });
}

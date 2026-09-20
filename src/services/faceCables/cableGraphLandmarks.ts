import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { graphInputNodes, sampleOperatorParameter, type OperatorParameters } from '../operators/effectGraph';

/** Cached tracking and the tracker output address the same source series; smoothing is part of provenance. */
export function cableGraphLandmarks(graph: EffectOperatorGraph, node: BoundOperatorNode | undefined, params: OperatorParameters) {
  let strength = 0;
  if (node?.operator === 'tracking.smooth') {
    strength = Number(sampleOperatorParameter(node, 'strength', params, '', [], 0));
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('Invalid landmark smoothing.');
    node = graphInputNodes(graph, node.id, 'landmarks')[0];
  }
  const source = node?.operator === 'tracking.face' ? graphInputNodes(graph, node.id, 'image')[0]
    : node?.operator === 'source.face-landmarks' ? graph.nodes.find(n => n.operator === 'media.source') : undefined;
  if (source?.operator !== 'media.source') throw new Error('Connect face tracking or saved face landmarks.');
  return { sourceId: source.id, strength, signature: `${source.id}:${strength}` };
}

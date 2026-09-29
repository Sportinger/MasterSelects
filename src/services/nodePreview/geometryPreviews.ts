import type { Keyframe } from '../../types/keyframes';
import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { getEffectOperator } from '../operators/operatorRegistry';
import { effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { compileGeometryGraph } from '../operators/geometry/geometryProgram';
import { evaluateGeometryProgram, type CurveSet } from '../operators/geometry/geometryEvaluation';
import { geometryParameterReader } from '../operators/geometry/weaveGraph';
import type { PreviewFrame, PreviewRequest } from './previewTypes';

const MAX_DRAWN_POINTS = 4000;

/** Wireframe of the curves at one node: every strand, decimated to a bounded number of drawn points. */
export function curveWireframe(curves: CurveSet): { points: number[]; edges: number[] } {
  const total = curves.positions.length / 3, stride = Math.max(1, Math.ceil(total / MAX_DRAWN_POINTS));
  const points: number[] = [], edges: number[] = [];
  for (let strand = 0; strand < curves.counts.length; strand++) {
    const start = curves.starts[strand], count = curves.counts[strand];
    const samples = [...Array.from({ length: Math.ceil(count / stride) }, (_, index) => index * stride), count - 1]
      .filter((point, index, all) => index === 0 || point > all[index - 1]);
    samples.forEach((point, index) => {
      const base = (start + point) * 3;
      if (index > 0) edges.push(points.length / 3 - 1, points.length / 3);
      points.push(curves.positions[base], curves.positions[base + 1], curves.positions[base + 2]);
    });
  }
  return { points, edges };
}

/** The curve node whose output a port shows: its own curves output or the source of a curves input. */
function curveSourceNode(graph: EffectOperatorGraph, nodeId: string, portId: string, direction: 'input' | 'output'): string | undefined {
  const node = graph.nodes.find(item => item.id === nodeId);
  const operator = node && getEffectOperator(node.operator);
  if (!node || !operator) return undefined;
  const inputSource = (input: string) => graph.edges.find(edge => edge.to === node.id && edge.input === input)?.from;
  if (direction === 'output' && operator.outputs.find(port => port.id === portId)?.type === 'curves') return node.id;
  if (direction === 'input' && operator.inputs.find(port => port.id === portId)?.type === 'curves') return inputSource(portId);
  if (node.operator === 'render.strands') return inputSource('curves');
  if (node.operator === 'scene.output') {
    const render = inputSource('scene');
    return render ? graph.edges.find(edge => edge.to === render && edge.input === 'curves')?.from : undefined;
  }
  return undefined;
}

/** CPU reference evaluation at the playhead; opening a viewer never touches GPU state. */
export function geometryPreview(request: PreviewRequest, effect: Effect, keys: Keyframe[], time: number): PreviewFrame {
  const base = { key: request.key, revision: request.revision, time: request.time };
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator') return { ...base, status: 'missing', label: 'Curve node unavailable' };
  try {
    const graph = effectOperatorGraph(effect);
    const port = request.port;
    const target = curveSourceNode(graph, binding.nodeId, port?.id ?? '', port?.direction ?? 'output');
    if (!target) return { ...base, status: 'live', label: 'Per-point value', presentation: 'text',
      drawing: { kind: 'text', lines: ['Evaluated once per curve point', 'where a modifier reads it'] } };
    const program = compileGeometryGraph(graph, geometryParameterReader(effectOperatorParams(effect), effect.id, keys, time), target,
      { time: request.time });
    const wireframe = curveWireframe(evaluateGeometryProgram(program));
    return { ...base, status: 'live', label: `${program.strandCount.toLocaleString('en-US')} curves · ${program.pointCount.toLocaleString('en-US')} points`,
      drawing: { kind: 'points', dimensions: 3, ...wireframe } };
  } catch (error) {
    return { ...base, status: 'error', label: error instanceof Error ? error.message : String(error) };
  }
}

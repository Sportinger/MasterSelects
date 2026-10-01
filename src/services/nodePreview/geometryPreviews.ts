import type { Keyframe } from '../../types/keyframes';
import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { getEffectOperator } from '../operators/operatorRegistry';
import { effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { compileGeometryGraph } from '../operators/geometry/geometryProgram';
import { evaluateGeometryProgram, type CurveSet } from '../operators/geometry/geometryEvaluation';
import { RodSimulationDeferred } from '../operators/geometry/rodCurves';
import { geometryParameterReader } from '../operators/geometry/weaveGraph';
import { compileClothSpec } from '../operators/geometry/clothProgram';
import { clothGridAt, type ClothGrid } from '../operators/geometry/clothSurface';
import { applyOperatorGroupBypasses } from '../operators/operatorGroupBypass';
import type { PreviewFrame, PreviewRequest } from './previewTypes';

const MAX_DRAWN_POINTS = 4000;
/**
 * Rod work (nodes × substeps) one preview may spend on the main thread, about a quarter second.
 * Simulations that need more to reach the playhead show their rest curves; the viewer simulates
 * them on the GPU.
 */
const PREVIEW_ROD_BUDGET = 300_000;

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

/** Wireframe of a simulated cloth grid: its rows and columns. */
export function clothWireframe(grid: ClothGrid): { points: number[]; edges: number[] } {
  const { columns, rows } = grid, points = Array.from(grid.positions), edges: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const index = j * (columns + 1) + i;
      if (i < columns) edges.push(index, index + 1);
      if (j < rows) edges.push(index, index + columns + 1);
    }
  }
  return { points, edges };
}

/** The Cloth Sheet a port shows: the sheet itself or the source of a cloth input. */
function clothSourceNode(graph: EffectOperatorGraph, nodeId: string, portId: string, direction: 'input' | 'output') {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (node?.operator === 'geometry.cloth-sheet') return node;
  if (direction !== 'input' || portId !== 'surface' || node?.operator !== 'geometry.surface-bind') return undefined;
  const edge = graph.edges.find(item => item.to === nodeId && item.input === 'surface');
  return graph.nodes.find(item => item.id === edge?.from && item.operator === 'geometry.cloth-sheet');
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
export function geometryPreview(request: PreviewRequest, effect: Effect, keys: Keyframe[], time: number, simulationTime = time): PreviewFrame {
  const base = { key: request.key, revision: request.revision, time: request.time };
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator') return { ...base, status: 'missing', label: 'Curve node unavailable' };
  try {
    const graph = effectOperatorGraph(effect);
    const port = request.port;
    const reader = geometryParameterReader(effectOperatorParams(effect), effect.id, keys, time);
    const cloth = clothSourceNode(graph, binding.nodeId, port?.id ?? '', port?.direction ?? 'output');
    if (cloth) {
      const grid = clothGridAt(compileClothSpec(applyOperatorGroupBypasses(graph), cloth, reader), simulationTime);
      return { ...base, status: 'live', label: `Cloth ${grid.columns} × ${grid.rows} · ${simulationTime.toFixed(2)} s`,
        drawing: { kind: 'points', dimensions: 3, ...clothWireframe(grid) } };
    }
    const target = curveSourceNode(graph, binding.nodeId, port?.id ?? '', port?.direction ?? 'output');
    if (!target) return { ...base, status: 'live', label: 'Per-point value', presentation: 'text',
      drawing: { kind: 'text', lines: ['Evaluated once per curve point', 'where a modifier reads it'] } };
    const program = compileGeometryGraph(graph, reader, target,
      { time: request.time, simulationTime });
    let curves: CurveSet, label = `${program.strandCount.toLocaleString('en-US')} curves · ${program.pointCount.toLocaleString('en-US')} points`;
    try {
      curves = evaluateGeometryProgram(program, { rodBudget: PREVIEW_ROD_BUDGET });
    } catch (error) {
      if (!(error instanceof RodSimulationDeferred)) throw error;
      curves = error.curves;
      label = 'Rest curves · the viewer simulates the rods';
    }
    return { ...base, status: 'live', label, drawing: { kind: 'points', dimensions: 3, ...curveWireframe(curves) } };
  } catch (error) {
    return { ...base, status: 'error', label: error instanceof Error ? error.message : String(error) };
  }
}

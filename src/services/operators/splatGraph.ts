import { splatScalarInputs } from './splatScalarInputs';
import { SCENE_OPERATORS } from './sceneOperators';
import type { BoundOperatorNode, SceneOperatorGraph } from '../../types/operatorGraph';
import type { SplatGraphBranch, SplatGraphOperation } from '../../types/splatGraph';
import { SPLAT_OPERATORS } from './splatOperators';
import { expandOperatorCompositions } from './operatorComposition';
import { Logger } from '../logger';

const log = Logger.create('SplatGraph');
const reported = new Set<string>();
/** Chains that render but cannot behave as configured must say why instead of failing silently. */
export function splatChainWarnings(operations: SplatGraphOperation[]): string[] {
  const warnings: string[] = [];
  operations.forEach((op, i) => {
    const before = operations.slice(0, i);
    if (op.kind === 'release' && !before.some(o => o.kind === 'falloff-box')) warnings.push('Release has no upstream Falloff Box; no splat is released.');
    if (op.kind === 'release' && op.values[10] > 0 && !before.some(o => o.kind === 'conveyor')) warnings.push('Release Cycle needs an upstream Conveyor; it falls back to the falloff weight.');
    if (op.kind === 'release' && op.values[10] > 0) {
      const conveyor = before.findLast(o => o.kind === 'conveyor'), bend = operations.slice(i + 1).find(o => o.kind === 'ring-bend');
      if (conveyor && bend && bend.values[2] !== 0 && Math.abs(Math.abs(bend.values[2]) * 2 * Math.PI - conveyor.values[3]) > conveyor.values[3] * 0.01) {
        warnings.push(`Release Cycle with an open Ring Bend: splats jump across the gap at the wrap seam. Use Radius ${(conveyor.values[3] / (2 * Math.PI)).toFixed(3)} to close the ring.`);
      }
    }
    if (op.kind === 'ring-bend' && op.values[0] === 1 && op.values[2] !== 0) warnings.push('Ring Bend needs axis X (0) or Z (2); it is ignored for axis Y.');
    if (op.kind !== 'falloff-box') return;
    const conveyor = before.findLast(o => o.kind === 'conveyor');
    if (!conveyor) return;
    const [axis, , start, length] = conveyor.values, reach = op.values[3 + axis] + op.values[6 + axis], center = op.values[axis];
    if (center < start || center >= start + length) warnings.push(`Falloff Box center ${center} lies outside the conveyor wrap range ${start}..${start + length}; the window stays empty.`);
    else if (2 * reach >= length) warnings.push(`Falloff Box window ${2 * reach} along the conveyor axis is not shorter than Wrap length ${length}; splats wrap visibly inside it.`);
  });
  return warnings;
}

export { defaultSplatGraph } from './splatGraphComposition';

/** Compile connected branches only. Bypassed attribute nodes pass through; surfaces mute. */
export function compileSplatGraph(definition: SceneOperatorGraph, time = 0): SplatGraphBranch[] {
  const graph = expandOperatorCompositions(definition.graph), { params } = definition;
  const driven = splatScalarInputs({ graph, params }, time);
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const parent = (node: BoundOperatorNode, port: string) => nodes.get(graph.edges.find(e => e.to === node.id && e.input === port)?.from ?? '');
  const values = (node: BoundOperatorNode) => (SCENE_OPERATORS.find(o => o.id === node.operator)?.parameters ?? []).map(p => {
    const key = node.bindings[p.id], input = driven(node, p.id), value = input ?? (typeof key === 'string' ? params[key] ?? p.default : node.constants?.[p.id] ?? p.default);
    if (typeof value !== 'number' || !Number.isFinite(value) || (input === undefined && (value < (p.min ?? -Infinity) || value > (p.max ?? Infinity)))) throw new Error(`Invalid ${p.label}.`);
    const bounded = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, value));
    return p.step === 1 ? Math.round(bounded) : bounded;
  });
  const ops = (node: BoundOperatorNode | undefined, visited = new Set<string>()): SplatGraphOperation[] | null => {
    if (!node) return null;
    if (visited.has(node.id)) throw new Error('Cycles are not supported.'); visited.add(node.id);
    if (node.operator === 'splat.source') return node.bypassed ? null : [];
    const spec = SPLAT_OPERATORS.find(o => o.id === node.operator);
    if (!spec || spec.outputs[0]?.type !== 'geometry') throw new Error('Connect a splat attribute stream.');
    const upstream = ops(parent(node, 'splats'), visited); if (!upstream || node.bypassed) return upstream;
    if (upstream.length >= 24) throw new Error('Use at most 24 attribute operations per branch.');
    let v = values(node); if (node.operator === 'splat.limit' && v[0] > v[1]) throw new Error('Minimum radius exceeds maximum radius.');
    if (node.operator === 'splat.release') {
      // Shared force nodes: Turbulence becomes the curl field, Gravity lifts (negative) or sinks, Drag shortens flights.
      v = [v[0], v[1], v[2], v[3], 0, 1, 0, 0, v[4], v[5], v[6], v[7], v[8], v[9], v[10]];
      for (const [port, operator, indexes] of [
        ['turbulenceField', 'forces.turbulence', [4, 5]], ['gravityField', 'forces.gravity', [6]], ['dragField', 'forces.drag', [7]],
      ] as const) {
        const field = parent(node, port);
        if (!field || field.bypassed) continue;
        if (field.operator !== operator) throw new Error(`Connect ${operator} to ${port}.`);
        values(field).forEach((value, i) => { v[indexes[i]] = value; });
      }
    }
    if (node.operator === 'splat.particles') {
      v = [v[0], v[1], v[2], 0, 2, 0, v[3], 0];
      for (const [port, operator, indexes] of [
        ['turbulenceField', 'splat.turbulence', [3, 4]], ['gravityField', 'splat.gravity', [7]], ['dragField', 'splat.drag', [5]],
      ] as const) {
        const field = parent(node, port);
        if (!field) continue;
        const shared = operator.replace('splat.', 'forces.');
        if (field.operator !== operator && field.operator !== shared) throw new Error(`Connect ${shared} to ${port}.`);
        const force = values(field);
        if (field.operator === 'forces.gravity') force[0] *= -1;
        indexes.forEach((index, i) => { v[index] = field.bypassed ? (index === 4 ? 2 : 0) : force[i]; });
      }
    }
    return [...upstream, { kind: node.operator.slice(6) as SplatGraphOperation['kind'], values: v }];
  };
  const result: SplatGraphBranch[] = [];
  const visit = (node: BoundOperatorNode | undefined, transform: boolean, visited = new Set<string>()) => {
    if (!node) return;
    if (visited.has(node.id)) throw new Error('Cycles are not supported.');
    const next = new Set(visited).add(node.id);
    if (node.operator === 'scene.clip-transform') { visit(parent(node, 'scene'), transform || !node.bypassed, next); return; }
    if (node.bypassed) return;
    if (node.operator === 'splat.merge') { for (const port of ['a', 'b', 'c', 'd']) visit(parent(node, port), transform, next); return; }
    if (node.operator === 'scene.mesh') {
      const geometry = parent(node, 'geometry'), material = parent(node, 'material');
      if (!geometry || !material || geometry.bypassed || material.bypassed) return;
      if (geometry.operator !== 'splat.surface' || material.operator !== 'material.wireframe') throw new Error('Connect reconstructed splat geometry and a Wireframe Material.');
      const operations = ops(parent(geometry, 'splats')); if (!operations) return;
      if (operations.some(op => op.kind !== 'sphere-crop')) throw new Error('Splats to Mesh accepts Splat Source and Sphere Crop nodes; other attribute modifiers are not supported.');
      const crops = operations.map(({ values: c }) => ({ center: [c[0], c[1], c[2]] as [number, number, number], radius: c[3], softness: c[4] }));
      const v = values(geometry), m = values(material);
      result.push({ id: `${node.id}-${result.length}`, outputNodeId: node.id, operations: [], applyClipTransform: transform,
        mesh: { resolution: v[0], threshold: v[1], radius: v[2], opacity: m[3], tint: [m[0], m[1], m[2]], ...(crops.length ? { crops } : {}) } });
    } else {
      if (node.operator !== 'splat.render') throw new Error('Connect a Gaussian surface or reconstructed mesh to the output.');
      const operations = ops(parent(node, 'splats')); if (!operations) return;
      result.push({ id: `${node.id}-${result.length}`, outputNodeId: node.id, operations, applyClipTransform: transform, budget: values(node)[0] });
      for (const warning of splatChainWarnings(operations)) if (!reported.has(warning)) { reported.add(warning); log.warn(warning); }
    }
    if (result.length > 8) throw new Error('Use at most eight rendered splat branches.');
  };
  const output = graph.nodes.find(n => n.operator === 'scene.render');
  if (output && !output.bypassed) visit(parent(output, 'scene'), false);
  return result.filter(b => b.mesh ? b.mesh.opacity > 0 : !b.operations.some(o => (o.kind === 'select' && o.values[0] === 0) || (o.kind === 'color' && o.values[3] === 0)));
}

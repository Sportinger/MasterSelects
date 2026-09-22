import { SCENE_OPERATORS } from './sceneOperators';
import type { SceneOperatorGraph } from '../../types/operatorGraph';

export function primitiveSplatGraph(exploration = false): SceneOperatorGraph {
  const definition: SceneOperatorGraph = { params: {}, graph: { version: 1, domain: 'scene', nodes: [], edges: [], layout: {} } };
  const add = (id: string, operator: string, x: number, y: number, values: Record<string, number> = {}) => {
    const bindings: Record<string, string> = {};
    for (const p of SCENE_OPERATORS.find(o => o.id === operator)?.parameters ?? []) {
      bindings[p.id] = `${id}_${p.id}`; definition.params[bindings[p.id]] = values[p.id] ?? p.default;
    }
    definition.graph.nodes.push({ id, operator, bindings }); definition.graph.layout[id] = { x, y };
  };
  const link = (from: string, output: string, to: string, input: string) => definition.graph.edges.push({ id: `${from}-${to}-${input}`, from, output, to, input });
  add('source', 'splat.source', 0, 0);
  add('surface', 'splat.render', 1120, 0, { budget: 0 });
  link('source', 'splats', 'surface', 'splats');
  let last = 'surface';
  if (exploration) {
    add('limit', 'splat.limit', 280, 0); add('fade', 'splat.camera-fade', 840, 0);
    definition.graph.edges = [];
    link('source', 'splats', 'limit', 'splats'); link('limit', 'splats', 'fade', 'splats'); link('fade', 'splats', 'surface', 'splats');
    add('selection', 'splat.select', 280, 260, { fraction: 0.08 });
    add('stretch', 'splat.scale', 560, 260, { x: 0.5, y: 18, z: 0.5 });
    add('motion', 'splat.noise', 840, 260, { attribute: 2, z: 8 });
    add('alpha', 'splat.color', 1120, 260, { alpha: 0.18 }); add('rays', 'splat.render', 1400, 260, { budget: 16384 });
    link('limit', 'splats', 'selection', 'splats'); link('selection', 'splats', 'stretch', 'splats'); link('stretch', 'splats', 'motion', 'splats'); link('motion', 'splats', 'alpha', 'splats'); link('alpha', 'splats', 'rays', 'splats');
    add('emit', 'splat.select', 280, 520, { fraction: 0.025 }); add('size', 'splat.limit', 560, 520, { min: 0.001, max: 0.004 });
    add('simulation', 'splat.particles', 840, 520); add('particle-fade', 'splat.camera-fade', 1120, 520); add('particles', 'splat.render', 1400, 520, { budget: 8192 });
    add('turbulence', 'forces.turbulence', 280, 1040); add('gravity', 'forces.gravity', 280, 1300, { strength: 0 }); add('drag', 'forces.drag', 560, 1300);
    link('turbulence', 'force', 'simulation', 'turbulenceField'); link('gravity', 'force', 'simulation', 'gravityField'); link('drag', 'drag', 'simulation', 'dragField');
    link('source', 'splats', 'emit', 'splats'); link('emit', 'splats', 'size', 'splats'); link('size', 'splats', 'simulation', 'splats'); link('simulation', 'splats', 'particle-fade', 'splats'); link('particle-fade', 'splats', 'particles', 'splats');
    add('reconstruct', 'splat.surface', 560, 780); link('source', 'splats', 'reconstruct', 'splats');
    add('wireframe', 'material.wireframe', 840, 1020); add('mesh', 'scene.mesh', 1120, 780);
    link('reconstruct', 'geometry', 'mesh', 'geometry'); link('wireframe', 'material', 'mesh', 'material');
    add('merge', 'splat.merge', 1680, 260);
    ['surface', 'rays', 'particles', 'mesh'].forEach((id, i) => link(id, 'scene', 'merge', 'abcd'[i])); last = 'merge';
  }
  add('transform', 'scene.clip-transform', exploration ? 1960 : 1400, 0); add('render', 'scene.render', exploration ? 2240 : 1680, 0);
  link(last, 'scene', 'transform', 'scene'); link('transform', 'scene', 'render', 'scene');
  return definition;
}

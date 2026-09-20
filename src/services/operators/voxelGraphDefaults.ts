import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { getEffectOperator } from './operatorRegistry';

/** The public effect controls bind to primitive nodes; no copied parameter state. */
export function createDefaultVoxelGraph(): EffectOperatorGraph {
  const specs = [
    ['frame', 'image.frame', 0, 100], ['uv', 'texture.uv', 0, 440], ['texture', 'texture.image', 280, 100],
    ['luminance', 'image.luminance', 600, 80], ['clamp', 'math.clamp', 860, 80], ['contrast', 'math.power', 1120, 80],
    ['height', 'math.multiply', 1380, 80], ['base', 'math.add', 1640, 80],
    ['grid', 'geometry.grid', 1380, 480], ['box', 'geometry.box', 1640, 480], ['geometry', 'geometry.instances', 1910, 80],
    ['material', 'material.surface', 1910, 500], ['mesh', 'scene.mesh', 2200, 100],
    ['camera', 'camera.orbit', 2200, 500], ['light', 'light.relief', 2200, 890], ['render', 'render.voxel', 2520, 100],
  ] as const;
  const special: Record<string, Record<string, string>> = { contrast: { b: 'heightContrast' }, height: { b: 'height' }, base: { b: 'baseHeight' } };
  const nodes = specs.map(([id, operator]) => ({ id, operator, bindings: Object.fromEntries(getEffectOperator(operator)!.parameters.map(param => [param.id,
    special[id]?.[param.id] ?? (['geometry.grid', 'geometry.instances', 'camera.orbit', 'light.relief', 'render.voxel'].includes(operator) ? param.id : `voxel_${id}_${param.id}`)])) }));
  const connections = [
    ['frame', 'image', 'texture', 'image'], ['uv', 'uv', 'texture', 'uv'], ['texture', 'texture', 'luminance', 'texture'],
    ['luminance', 'value', 'clamp', 'a'], ['clamp', 'value', 'contrast', 'a'], ['contrast', 'value', 'height', 'a'], ['height', 'value', 'base', 'a'],
    ['base', 'value', 'geometry', 'height'], ['grid', 'points', 'geometry', 'points'], ['box', 'geometry', 'geometry', 'geometry'],
    ['texture', 'texture', 'material', 'texture'], ['geometry', 'geometry', 'mesh', 'geometry'], ['material', 'material', 'mesh', 'material'],
    ['mesh', 'scene', 'render', 'scene'], ['camera', 'camera', 'render', 'camera'], ['light', 'light', 'render', 'light'],
  ];
  return { version: 1, domain: 'voxel', nodes, layout: Object.fromEntries(specs.map(([id, , x, y]) => [id, { x, y }])),
    edges: connections.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
    groups: [
      { id: 'geometry-build', label: 'Column geometry', color: '#d7a262', nodeIds: ['grid', 'box', 'geometry'] },
      { id: 'height-field', parentId: 'geometry-build', label: 'Height field', color: '#87b99a', nodeIds: ['luminance', 'clamp'] },
      { id: 'height-math', parentId: 'height-field', label: 'Height calculation', color: '#bb91dd', nodeIds: ['contrast', 'height', 'base'] },
    ],
  };
}

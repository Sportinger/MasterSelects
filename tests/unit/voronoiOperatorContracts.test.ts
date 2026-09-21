import { describe, expect, it } from 'vitest';
import { voronoi } from '../../src/effects/geometry';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { getOperatorPortContract, operatorPortsCompatible } from '../../src/services/operators/portContracts';
import type { OperatorPort } from '../../src/types/operatorGraph';

describe('Voronoi operator contracts', () => {
  it('keeps nearest-seed fields distinct from scalar fields, images, and textures', () => {
    const seeds = getEffectOperator('geometry.voronoi-seeds')!;
    const jump = getEffectOperator('geometry.jump-flood')!;
    const read = getEffectOperator('field.read-nearest-seed')!;
    const output = seeds.outputs[0];

    expect(operatorPortsCompatible(output, jump.inputs[0])).toBe(true);
    expect(operatorPortsCompatible(jump.outputs[0], read.inputs[0])).toBe(true);
    for (const type of ['field', 'image', 'texture'] as const) {
      const incompatible: OperatorPort = { id: type, label: type, type };
      expect(operatorPortsCompatible(output, incompatible)).toBe(false);
    }
    expect(getOperatorPortContract(output).formats).toEqual(['nearest-seed-rgba16float']);
    expect(read.outputs).toEqual([{ id: 'value', label: 'Seed Record', type: 'vec4' }]);
  });

  it('uses authoritative Voronoi catalog metadata without exposing unfinished nodes', () => {
    const seeds = getEffectOperator('geometry.voronoi-seeds')!;
    expect(seeds.parameters).toEqual(['scale', 'speed'].map(id => {
      const spec = voronoi.params[id];
      if (!spec || spec.type !== 'number') throw new Error(`Expected numeric ${id}.`);
      return { id, label: spec.label, type: 'number', default: spec.default, min: spec.min, max: spec.max,
        step: spec.step, animatable: spec.animatable };
    }));
    for (const id of ['geometry.voronoi-seeds', 'geometry.jump-flood', 'field.read-nearest-seed']) {
      expect(getEffectOperator(id)?.addable).toBe(false);
    }
    expect(seeds.description).toContain('XY is the seed pixel coordinate');
    expect(getEffectOperator('field.read-nearest-seed')?.description).toContain('Truncates the pixel coordinate');
  });
});

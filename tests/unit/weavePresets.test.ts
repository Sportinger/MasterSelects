import { describe, expect, it } from 'vitest';
import { listBuiltInWeavePresets } from '../../src/services/operators/geometry/weavePresets';
import { instantiateEffectPreset } from '../../src/services/nodeGraph/effectPresetLibrary';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';

const ring = () => instantiateEffectPreset(listBuiltInWeavePresets()[0]);
const at = (time: number) => {
  const effect = ring();
  return compileGeometryGraph(effect.operatorGraph!, geometryParameterReader(effect.params), undefined, { simulationTime: time });
};

describe('built-in Weave studies', () => {
  it('keeps every recovered graph valid with independent durable copies', () => {
    for (const preset of listBuiltInWeavePresets()) {
      const first = instantiateEffectPreset(preset), second = instantiateEffectPreset(preset);
      expect(first.id).not.toBe(second.id);
      expect(validateWeaveGraph(first.operatorGraph!)).toEqual([]);
      const program = compileGeometryGraph(first.operatorGraph!, geometryParameterReader(first.params));
      expect(isGeometryProgram(JSON.parse(JSON.stringify(program)))).toBe(true);
      first.operatorGraph!.nodes[0].bypassed = true;
      expect(second.operatorGraph!.nodes[0].bypassed).not.toBe(true);
      expect(listBuiltInWeavePresets().find(item => item.id === preset.id)!.effect.operatorGraph!.nodes[0].bypassed).not.toBe(true);
    }
  });

  it('restores four closed ropes, advances the baked study, and holds its finite endpoints', () => {
    const start = evaluateGeometryProgram(at(0)), middle = evaluateGeometryProgram(at(16.9));
    expect(start.counts).toHaveLength(4);
    expect([...start.counts]).toEqual([641, 641, 641, 641]);
    for (let row = 0; row < 4; row++) {
      const first = start.starts[row] * 3, last = (start.starts[row] + start.counts[row] - 1) * 3;
      expect(Math.hypot(...[0, 1, 2].map(axis => start.positions[first + axis] - start.positions[last + axis]))).toBeLessThan(0.0002);
    }
    expect([...middle.positions].every(Number.isFinite)).toBe(true);
    expect(middle.positions).not.toEqual(start.positions);
    expect(evaluateGeometryProgram(at(-1)).positions).toEqual(start.positions);
    expect(evaluateGeometryProgram(at(60)).positions).toEqual(evaluateGeometryProgram(at(33.8)).positions);
    expect(evaluateGeometryProgram(at(16.9)).positions).toEqual(middle.positions);
  });
});

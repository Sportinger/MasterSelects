import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createWorkerSoftwareFeedbackStore } from '../../src/services/render/workerSoftwareFeedbackEffects';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const graph: EffectOperatorGraph = {
  version: 1, schemaVersion: 1, domain: 'image', layout: {},
  nodes: [
    { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: 'history', operator: 'image.frame-history', operatorVersion: 1, bindings: {} },
    { id: 'source-rgba', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} },
    { id: 'history-rgba', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} },
    { id: 'half', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .5 } },
    { id: 'mix', operator: 'math.mix.rgb', operatorVersion: 1, bindings: {} },
    { id: 'combine', operator: 'vector.combine.rgba', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  ],
  edges: [
    ['frame', 'image', 'source-rgba', 'image'], ['history', 'image', 'history-rgba', 'image'],
    ['source-rgba', 'rgb', 'mix', 'a'], ['history-rgba', 'rgb', 'mix', 'b'], ['half', 'value', 'mix', 't'],
    ['mix', 'value', 'combine', 'rgb'], ['source-rgba', 'alpha', 'combine', 'alpha'], ['combine', 'image', 'output', 'image'],
  ].map(([from, output, to, input], index) => ({ id: String(index), from, output, to, input })),
};

describe('software temporal image graphs', () => {
  it('uses the shared history owner for hold, advance, seek and continuous loops', () => {
    const plan = compileImageOperatorGraph(graph, {}, { allowFrameHistory: true });
    const store = createWorkerSoftwareFeedbackStore();
    const render = (red: number, time: number, eventRevision = 0, discontinuity?: 'seek' | 'loop', feedbackKey = 'effect') => {
      const data = new Uint8ClampedArray([red, 0, 0, 127]);
      applyWorkerSoftwareImageGraphs(data, 1, 1, [plan], time, {
        owners: [{ feedbackKey, reset: false, historyLoop: 'continuous' }], store, scopeId: 'preview',
        frame: { timelineTimeSeconds: time, eventRevision, discontinuity, compositionId: 'comp', ownerRevision: 1 },
      });
      expect(data[3]).toBe(127);
      return data[0];
    };
    expect(render(200, 0)).toBe(100);
    expect(render(200, 0)).toBe(100);
    expect(render(100, 0)).toBe(50);
    expect(render(200, 1)).toBe(125);
    expect(render(200, 1)).toBe(125);
    expect(render(100, 0, 1, 'loop')).toBe(113);
    expect(render(100, 0, 1, 'loop')).toBe(113);
    expect(render(100, 3, 2, 'seek')).toBe(50);
    expect(render(100, 3, 2, 'seek', 'other-effect')).toBe(50);
  });

  it('rejects missing history ownership before changing any pixels', () => {
    const plan = compileImageOperatorGraph(graph, {}, { allowFrameHistory: true });
    const data = new Uint8ClampedArray([90, 60, 30, 127]), original = data.slice();
    expect(() => applyWorkerSoftwareImageGraphs(data, 1, 1, [plan], 0)).toThrow(/explicit effect owner/);
    expect(data).toEqual(original);
  });
});

import { describe, expect, it } from 'vitest';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph, validateAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';
import { ANALOG_SIGNAL_LAB_PARAMS } from '../../src/effects/analog/signal-lab/parameters';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';

describe('Analog Signal operator graph compiler', () => {
  it('lowers the real branched six-stage pipeline with stable effect parameter bindings', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.find(node => node.id === 'vhs')!.constants = { vhsAmount: 0.55 };
    const plan = compileAnalogSignalGraph(graph, { rfNoise: 0.7, decoder: 'comb', tapeSpeed: 'ep' });
    expect(plan.stages.map(stage => stage.kind)).toEqual(['encode', 'rf', 'vhs', 'analyze', 'decode', 'resolve']);
    expect(plan.stages.find(stage => stage.kind === 'decode')).toMatchObject({ input: 'vhs', receiver: 'analyze', params: { rfNoise: 0.7, decoder: 'comb', tapeSpeed: 'ep', vhsAmount: 0.55 } });
    expect(plan.stages.find(stage => stage.kind === 'resolve')).toMatchObject({ input: 'decode', source: 'frame', params: { vhsAmount: 0.55 } });
    expect(plan.output).toBe('resolve');
    expect(plan.passthrough).toBe(false);
    expect(compileAnalogSignalGraph(graph, { rfNoise: 0.7, decoder: 'comb', tapeSpeed: 'ep' }).key).toBe(plan.key);
  });

  it('aliases bypassable transport stages and forces their downstream amounts to zero', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.find(node => node.id === 'rf')!.bypassed = true;
    graph.nodes.find(node => node.id === 'vhs')!.bypassed = true;
    const plan = compileAnalogSignalGraph(graph);
    expect(plan.stages.map(stage => stage.kind)).not.toEqual(expect.arrayContaining(['rf', 'vhs']));
    expect(plan.stages.find(stage => stage.kind === 'analyze')?.input).toBe('encode');
    expect(plan.stages.find(stage => stage.kind === 'decode')).toMatchObject({ input: 'encode', params: { rfAmount: 0, vhsAmount: 0 } });
    expect(plan.stages.find(stage => stage.kind === 'resolve')?.params).toMatchObject({ rfAmount: 0, vhsAmount: 0 });
  });

  it('derives effective amounts from the decode signal lineage rather than another branch', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes = graph.nodes.filter(node => node.id !== 'vhs');
    graph.edges = graph.edges.filter(edge => !edge.id.includes('vhs'));
    graph.edges.push(
      { id: 'rf-analyze', from: 'rf', output: 'signal', to: 'analyze', input: 'signal' },
      { id: 'encode-decode', from: 'encode', output: 'signal', to: 'decode', input: 'signal' },
    );
    delete graph.layout.vhs;
    const plan = compileAnalogSignalGraph(graph, { rfAmount: 0.8 });
    expect(plan.stages.find(stage => stage.kind === 'analyze')?.input).toBe('rf');
    expect(plan.stages.find(stage => stage.kind === 'decode')?.params.rfAmount).toBe(0);
    expect(plan.stages.find(stage => stage.kind === 'resolve')?.params.rfAmount).toBe(0);
  });

  it('supports a direct frame-to-output passthrough and rejects fixed-format rewiring', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes = graph.nodes.filter(node => node.id === 'frame' || node.id === 'output');
    graph.edges = [{ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' }];
    graph.layout = { frame: graph.layout.frame, output: graph.layout.output };
    expect(compileAnalogSignalGraph(graph)).toMatchObject({ stages: [], output: 'frame', passthrough: true });

    const invalid = createDefaultAnalogSignalGraph();
    invalid.edges.find(edge => edge.id === 'decode-resolve')!.from = 'frame';
    expect(validateAnalogSignalGraph(invalid)).toEqual(expect.arrayContaining([expect.stringContaining('decode-resolve')]));
  });

  it('derives select options and numeric bounds from the effect parameter source', () => {
    const decode = getEffectOperator('analog.pal-decode')!;
    const decoder = decode.parameters.find(parameter => parameter.id === 'decoder')!;
    expect({ type: decoder.type, default: decoder.default, options: decoder.options })
      .toEqual({ type: ANALOG_SIGNAL_LAB_PARAMS.decoder.type, default: ANALOG_SIGNAL_LAB_PARAMS.decoder.default, options: ANALOG_SIGNAL_LAB_PARAMS.decoder.options });
    const tapeSpeed = getEffectOperator('analog.vhs-transport')!.parameters.find(parameter => parameter.id === 'tapeSpeed')!;
    expect(tapeSpeed.options).toEqual(ANALOG_SIGNAL_LAB_PARAMS.tapeSpeed.options);
    const delay = getEffectOperator('analog.rf-channel')!.parameters.find(parameter => parameter.id === 'ghostDelayUs')!;
    expect({ min: delay.min, max: delay.max, step: delay.step, default: delay.default })
      .toEqual({ min: 0.05, max: 12, step: 0.05, default: 1.8 });
    const owned = ['analog.pal-encode', 'analog.rf-channel', 'analog.vhs-transport', 'analog.receiver-analyze', 'analog.pal-decode', 'analog.display-resolve']
      .flatMap(id => getEffectOperator(id)!.parameters.map(parameter => parameter.id));
    expect(owned.toSorted()).toEqual(Object.keys(ANALOG_SIGNAL_LAB_PARAMS).toSorted());
    expect(new Set(owned).size).toBe(owned.length);
  });
});

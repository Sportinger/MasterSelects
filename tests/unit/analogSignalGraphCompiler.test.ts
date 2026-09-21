import { describe, expect, it } from 'vitest';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph, validateAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';
import { ANALOG_SIGNAL_LAB_PARAMS } from '../../src/effects/analog/signal-lab/parameters';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { createLegacyAnalogSignalGraph } from '../helpers/legacyAnalogSignalGraph';

describe('Analog Signal operator graph compiler', () => {
  it('rejects fragment derivatives before building a compute program', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.push({ id: 'fragment-gradient', operator: 'image.derivative.coarse.scalar', operatorVersion: 1, bindings: {} });
    expect(validateAnalogSignalGraph(graph)).toContain('Analog compute resolve does not support fragment derivatives: fragment-gradient.');
    expect(() => compileAnalogSignalGraph(graph, {})).toThrow(/fragment derivatives/);
  });
  it('lowers the real branched six-stage pipeline with stable effect parameter bindings', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.find(node => node.id === 'vhs')!.constants = { vhsAmount: 0.55 };
    const plan = compileAnalogSignalGraph(graph, { rfNoise: 0.7, decoder: 'comb', tapeSpeed: 'ep' });
    expect(plan.stages.map(stage => stage.kind)).toEqual(['encode', 'rf', 'vhs', 'analyze', 'decode', 'resolve']);
    expect(plan.stages.find(stage => stage.kind === 'decode')).toMatchObject({ input: 'vhs', receiver: 'analyze', params: { rfNoise: 0.7, decoder: 'comb', tapeSpeed: 'ep', vhsAmount: 0.55 } });
    expect(plan.stages.find(stage => stage.kind === 'resolve')).toMatchObject({ input: 'decode', source: 'frame', params: { vhsAmount: 0.55 } });
    const resolve = plan.stages.find(stage => stage.kind === 'resolve')!;
    expect(resolve.imageProgram?.resourceInputs).toEqual(expect.arrayContaining(['source', 'decoded']));
    expect(resolve.imageProgram?.resourceSampling).toEqual(['manual-bilinear-clamp', 'manual-bilinear-clamp']);
    expect(plan.output).toBe(resolve.nodeId);
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

    const invalid = createLegacyAnalogSignalGraph();
    invalid.edges.find(edge => edge.id === 'decode-resolve')!.from = 'frame';
    expect(validateAnalogSignalGraph(invalid)).toEqual(expect.arrayContaining([expect.stringContaining('decode-resolve')]));
  });

  it('keeps the persisted legacy Display Resolve compiler path unchanged', () => {
    const plan = compileAnalogSignalGraph(createLegacyAnalogSignalGraph(), { palAmount: .7, rfAmount: .4 });
    const resolve = plan.stages.find(stage => stage.kind === 'resolve')!;
    expect(resolve.nodeId).toBe('resolve');
    expect(resolve.imageProgram).toBeUndefined();
    expect(resolve).toMatchObject({ source: 'frame', input: 'decode' });
  });

  it('resolves renamed frame/decode boundaries and avoids compiler-node ID collisions', () => {
    const graph = createDefaultAnalogSignalGraph();
    for (const [from, to] of [['frame', 'camera'], ['decode', 'decoder']] as const) {
      graph.nodes.find(node => node.id === from)!.id = to;
      for (const edge of graph.edges) { if (edge.from === from) edge.from = to; if (edge.to === from) edge.to = to; }
      graph.layout[to] = graph.layout[from]!; delete graph.layout[from];
    }
    graph.nodes.push({ id: '__analog-source', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0 } });
    graph.layout['__analog-source'] = { x: 0, y: 1000 };
    const resolve = compileAnalogSignalGraph(graph).stages.find(stage => stage.kind === 'resolve')!;
    expect(resolve).toMatchObject({ source: 'camera', input: 'decoder' });
    expect(resolve.imageProgram?.resourceInputs).toEqual(expect.arrayContaining(['source', 'decoded']));
  });

  it('allows a valid source-only image island without inventing a decode resource', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.push(
      { id: 'source-vector', operator: 'convert.image-to-vec4', operatorVersion: 1, bindings: {} },
      { id: 'source-image', operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} },
    );
    graph.layout['source-vector'] = { x: 1800, y: 900 }; graph.layout['source-image'] = { x: 2100, y: 900 };
    graph.edges = graph.edges.filter(edge => !(edge.to === 'output' && edge.input === 'image'));
    graph.edges.push(
      { id: 'frame-source-vector', from: 'frame', output: 'image', to: 'source-vector', input: 'image' },
      { id: 'source-vector-image', from: 'source-vector', output: 'value', to: 'source-image', input: 'value' },
      { id: 'source-image-output', from: 'source-image', output: 'image', to: 'output', input: 'image' },
    );
    const resolve = compileAnalogSignalGraph(graph).stages.find(stage => stage.kind === 'resolve')!;
    expect(resolve).toMatchObject({ source: 'frame' });
    expect(resolve.input).toBeUndefined();
    expect(resolve.imageProgram?.resourceInputs).toEqual(['source']);
  });

  it('allows a decoded-only image island without inventing a source resource', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.push(
      { id: 'decoded-vector', operator: 'convert.image-to-vec4', operatorVersion: 1, bindings: {} },
      { id: 'decoded-image', operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} },
    );
    graph.layout['decoded-vector'] = { x: 1800, y: 900 }; graph.layout['decoded-image'] = { x: 2100, y: 900 };
    graph.edges = graph.edges.filter(edge => !(edge.to === 'output' && edge.input === 'image'));
    graph.edges.push(
      { id: 'decode-vector', from: 'decode', output: 'image', to: 'decoded-vector', input: 'image' },
      { id: 'decode-image', from: 'decoded-vector', output: 'value', to: 'decoded-image', input: 'value' },
      { id: 'decoded-output', from: 'decoded-image', output: 'image', to: 'output', input: 'image' },
    );
    const resolve = compileAnalogSignalGraph(graph).stages.find(stage => stage.kind === 'resolve')!;
    expect(resolve).toMatchObject({ input: 'decode' });
    expect(resolve.source).toBeUndefined();
    expect(resolve.imageProgram?.resourceInputs).toEqual(['decoded']);
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioGraphOperators, audioMathProgram, compileAudioOperatorGraph, createDefaultAudioOperatorGraph, processAudioMathChannels, readAudioOperatorGraph } from '../../src/services/operators/audioOperatorGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { AudioEffectRenderer } from '../../src/engine/audio/AudioEffectRenderer';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { collectAudioEffectInstanceRouteSettings } from '../../src/services/audio/graphRoute/processorInstanceMapping';
import { createProcessorNode } from '../../src/services/audio/routing/processorNodeFactory';
import { attachScrubSampleProcessor } from '../../src/services/proxyFrame/scrubAudioSampleProcessors';
import type { ScrubProcessorNode } from '../../src/services/proxyFrame/scrubAudioProcessing';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { createEffectGraphActions, setOperatorConstant } from '../../src/services/operators/effectGraphEditing';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { operatorAddMenu } from '../../src/services/operators/operatorAddMenu';
import { mathModeOptions, setMathNodeMode } from '../../src/services/nodeGraph/mathNodeEditing';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';

const initial = useTimelineStore.getState();
afterEach(() => { useTimelineStore.setState(initial); vi.restoreAllMocks(); });
function gainedGraph(gain: number) {
  const graph = createDefaultAudioOperatorGraph();
  graph.nodes.find(node => node.id === 'gain')!.constants!.value = gain;
  return graph;
}
function sampleBuffer() {
  const buffer = createBuffer(2, 512, 48_000);
  for (let sample = 0; sample < buffer.length; sample++) {
    buffer.getChannelData(0)[sample] = Math.sin(sample * 0.03) * 0.4;
    buffer.getChannelData(1)[sample] = Math.cos(sample * 0.09) * 0.2;
  }
  return buffer;
}
describe('sample-domain operator graphs', () => {
  it.each([
    ['add', -0.25, 2, 0.25, 1.75], ['subtract', -0.25, 2, 0.25, -2.25],
    ['multiply', -0.25, 2, 0.25, -0.5], ['divide-ieee', -0.25, 2, 0.25, -0.125],
    ['min', -0.25, 2, 0.25, -0.25], ['max', -0.25, 2, 0.25, 2],
    ['clamp', -0.25, 0, 1, 0], ['abs', -0.25, 0, 0, 0.25],
    ['sin', Math.PI / 2, 0, 0, 1], ['cos', 0, 0, 0, 1],
    ['floor', -0.25, 0, 0, -1], ['fract', -0.25, 0, 0, 0.75],
    ['mix', -0.25, 2, 0.25, 0.3125],
  ] as const)('executes %s with the registered port roles', (operation, a, b, c, expected) => {
    const operator = audioGraphOperators().find(node => node.family === `math.${operation}` && node.inputs[0]?.type === 'audio'
      && node.inputs.slice(1).every(input => input.type === 'number'))!;
    expect(operator).toBeDefined();
    const graph = gainedGraph(b);
    graph.nodes.find(node => node.id === 'multiply')!.operator = operator.id;
    graph.nodes.push({ id: 'third', operator: 'values.number', bindings: {}, constants: { value: c } });
    graph.edges = [graph.edges[2], ...operator.inputs.map((port, i) => ({ id: `input-${i}`, from: ['input', 'gain', 'third'][i],
      output: i ? 'value' : 'audio', to: 'multiply', input: port.id }))];
    const output = new Float32Array(1);
    processAudioMathChannels(compileAudioOperatorGraph(graph), [new Float32Array([a])], [output]);
    expect(output[0]).toBeCloseTo(expected, 6);
    expect(getEffectOperator(operator.id)).toBe(operator);
  });

  it('has identical results across block sizes and silences missing channels', () => {
    const program = compileAudioOperatorGraph(gainedGraph(0.75));
    const input = sampleBuffer().getChannelData(0), full = new Float32Array(input.length), chunked = new Float32Array(input.length);
    processAudioMathChannels(program, [input], [full]);
    for (let start = 0; start < input.length; start += 37) processAudioMathChannels(program,
      [input.subarray(start, start + 37)], [chunked.subarray(start, start + 37)]);
    expect(chunked).toEqual(full);
    const silent = new Float32Array(3).fill(1);
    processAudioMathChannels(program, [], [silent]);
    expect([...silent]).toEqual([0, 0, 0]);
  });

  it('broadcasts constants over samples without merging channels or mutating source buffers', () => {
    const inputs = [new Float32Array([-0.25, 0, 0.5]), new Float32Array([0.3, -0.5, 0.1])];
    const outputs = inputs.map(channel => new Float32Array(channel.length));
    processAudioMathChannels(compileAudioOperatorGraph(gainedGraph(2)), inputs, outputs);
    expect([...outputs[0]]).toEqual([-0.5, 0, 1]);
    expect(outputs[1][0]).toBeCloseTo(0.6);
    expect([...inputs[0]]).toEqual([-0.25, 0, 0.5]);
  });

  it('adapts the same Multiply family to two audio streams', () => {
    const original = createDefaultAudioOperatorGraph();
    const graph = connectEffectGraph(original, { id: 'square', from: 'input', output: 'audio', to: 'multiply', input: 'b' }, audioGraphOperators());
    expect(graph.nodes.find(node => node.id === 'multiply')?.operator).toBe('math.multiply.audio-audio');
    const output = new Float32Array(2);
    processAudioMathChannels(compileAudioOperatorGraph(graph), [new Float32Array([-0.5, 0.25])], [output]);
    expect([...output]).toEqual([0.25, 0.0625]);
    expect(operatorAddMenu(audioGraphOperators()).filter(node => node.family === 'math.multiply')).toHaveLength(1);
  });

  it('bypasses a Number × Audio node through its audio input', () => {
    const graph = gainedGraph(2);
    const node = graph.nodes.find(node => node.id === 'multiply')!;
    node.operator = 'math.multiply.scalar-audio'; node.bypassed = true;
    graph.edges.find(edge => edge.from === 'input')!.input = 'b';
    graph.edges.find(edge => edge.from === 'gain')!.input = 'a';
    const samples = new Float32Array([-0.5, 0.25]), output = new Float32Array(2);
    processAudioMathChannels(compileAudioOperatorGraph(graph), [samples], [output]);
    expect(output).toEqual(samples);
  });

  it('keeps playback, scrubbing and the export renderer sample-identical', async () => {
    const effect = { id: 'sample-fx', descriptorId: 'audio-math', enabled: true, params: { operatorGraph: JSON.stringify(gainedGraph(-0.5)) } };
    const input = sampleBuffer();
    const exported = await new AudioEffectRenderer().renderEffectInstances(input, [effect], []);
    const settings = collectAudioEffectInstanceRouteSettings([effect]);
    expect(settings.processors).toHaveLength(1);
    const scriptProcessor = { onaudioprocess: null } as unknown as ScriptProcessorNode;
    const playback = createProcessorNode({ createScriptProcessor: vi.fn(() => scriptProcessor) } as unknown as BaseAudioContext,
      settings.processors[0], {} as never);
    const played = createBuffer(2, input.length, input.sampleRate);
    playback.scriptProcessor!.onaudioprocess!.call(scriptProcessor, { inputBuffer: input, outputBuffer: played } as AudioProcessingEvent);
    const scrub = { scriptProcessor: { onaudioprocess: null }, sampleProcessor: settings.processors[0] } as unknown as ScrubProcessorNode;
    attachScrubSampleProcessor(scrub);
    const scrubbed = createBuffer(2, input.length, input.sampleRate);
    scrub.scriptProcessor!.onaudioprocess!.call(scrub.scriptProcessor!, { inputBuffer: input, outputBuffer: scrubbed } as AudioProcessingEvent);
    for (let channel = 0; channel < 2; channel++) {
      expect(played.getChannelData(channel)).toEqual(exported.getChannelData(channel));
      expect(scrubbed.getChannelData(channel)).toEqual(exported.getChannelData(channel));
    }
    expect(exported.sampleRate).toBe(input.sampleRate);
    expect(exported.getChannelData(0)[20]).toBeCloseTo(input.getChannelData(0)[20] * -0.5);
  });

  it('rejects incompatible executors, malformed data and cycles instead of silently defaulting', () => {
    expect(() => readAudioOperatorGraph('{')).toThrow();
    const graph = createDefaultAudioOperatorGraph();
    graph.nodes.find(node => node.id === 'multiply')!.operator = 'math.multiply.vec2';
    expect(() => compileAudioOperatorGraph(graph)).toThrow();
    const cyclic = createDefaultAudioOperatorGraph();
    cyclic.edges[0].from = 'multiply'; cyclic.edges[0].output = 'value';
    expect(() => compileAudioOperatorGraph(cyclic)).toThrow();
  });

  it('contains nonfinite arithmetic at the output and pauses incomplete edits as pass-through', () => {
    const graph = gainedGraph(0);
    graph.nodes.find(node => node.id === 'multiply')!.operator = 'math.divide-ieee.audio-scalar';
    const output = new Float32Array(2), input = new Float32Array([1, 0]);
    processAudioMathChannels(compileAudioOperatorGraph(graph), [input], [output]);
    expect([...output]).toEqual([0, 0]);
    graph.incomplete = 'Connect the missing input.'; graph.edges.pop();
    processAudioMathChannels(compileAudioOperatorGraph(graph), [input], [output]);
    expect(output).toEqual(input);
  });

  it('edits and restores the native audio owner through the existing node controls', () => {
    const effect = { id: 'audio-owner', descriptorId: 'audio-math', enabled: true, params: { operatorGraph: '' } };
    const clip = createMockClip({ id: 'audio-clip', source: { type: 'audio' }, audioState: { effectStack: [effect] } });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
    setOperatorConstant(clip.id, effect.id, 'gain', 'value', 0.25);
    const current = useTimelineStore.getState().clips[0];
    expect(current.effects).toEqual(clip.effects);
    const saved = current.audioState!.effectStack![0].params.operatorGraph;
    expect(readAudioOperatorGraph(saved).nodes.find(node => node.id === 'gain')?.constants?.value).toBe(0.25);
    expect(audioMathProgram(saved)).toBe(audioMathProgram(saved));
    const document = buildClipNodeGraphDocument(current);
    const unified = buildUnifiedClipGraph(document, current, [current]);
    expect(unified.nodes.some(node => node.operatorId === 'audio.input')).toBe(true);
    expect(unified.nodes.find(node => node.operatorId === 'math.multiply.audio-scalar')?.connectionVariants?.length).toBeGreaterThan(1);
    const actions = createEffectGraphActions(clip.id, effect.id);
    const nodeId = actions.addNode('math.add.scalar');
    actions.connectPorts({ fromNodeId: 'input', fromPortId: 'audio', toNodeId: nodeId, toPortId: 'a' });
    const edited = readAudioOperatorGraph(useTimelineStore.getState().clips[0].audioState!.effectStack![0].params.operatorGraph);
    expect(edited.nodes.find(node => node.id === nodeId)?.operator).toBe('math.add.audio-scalar');
    useTimelineStore.setState({ tracks: [createMockTrack({ id: clip.trackId, locked: true })] });
    expect(() => setOperatorConstant(clip.id, effect.id, 'gain', 'value', 1)).toThrow('locked');
  });

  it('keeps linked audio ownership when editing from the shared video canvas', () => {
    const effect = { id: 'linked-audio-math', descriptorId: 'audio-math', enabled: true, params: { operatorGraph: '' } };
    const video = createMockClip({ id: 'video', linkedClipId: 'audio', source: { type: 'video' } });
    const audio = createMockClip({ id: 'audio', trackId: 'audio-track', linkedClipId: 'video', source: { type: 'audio' }, audioState: { effectStack: [effect] } });
    useTimelineStore.setState({ clips: [video, audio], tracks: [createMockTrack({ id: video.trackId }), createMockTrack({ id: audio.trackId, type: 'audio' })] });
    const document = buildClipNodeGraphDocument(video, undefined, { linkedClip: audio });
    const unified = buildUnifiedClipGraph(document, video, [video, audio]);
    const multiply = unified.nodes.find(node => node.operatorId === 'math.multiply.audio-scalar')!;
    expect(multiply.params?.targetClipId).toBe(audio.id);
    expect(unified.groups?.find(group => group.effectId === effect.id)?.layoutMode).toBe('flow');
    setOperatorConstant(video.id, effect.id, 'gain', 'value', 0.75);
    setMathNodeMode(video.id, multiply, 'math.add.audio-scalar');
    const [savedVideo, savedAudio] = useTimelineStore.getState().clips;
    expect(savedVideo.effects).toEqual([]);
    const saved = readAudioOperatorGraph(savedAudio.audioState!.effectStack![0].params.operatorGraph);
    expect(saved.nodes.find(node => node.id === 'gain')?.constants?.value).toBe(0.75);
    expect(saved.nodes.find(node => node.id === 'multiply')?.operator).toBe('math.add.audio-scalar');
    const valueMath = { ...multiply, operatorId: 'math.add.scalar' };
    expect(mathModeOptions(valueMath).some(option => option.value === 'math.atan2.scalar')).toBe(false);
    expect(() => setMathNodeMode(video.id, valueMath, 'math.atan2.scalar')).toThrow('not supported');
    useTimelineStore.setState({ tracks: [createMockTrack({ id: audio.trackId, type: 'audio', locked: true })] });
    expect(() => setOperatorConstant(video.id, effect.id, 'gain', 'value', 1)).toThrow('locked');
  });
});

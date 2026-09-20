import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { Effect } from '../../types/effects';
import { voxelOperatorGraph } from '../operators/voxelGraph';
import { getEffectOperator } from '../operators/operatorRegistry';
import { operatorEnabled, sampleOperatorParameter } from '../operators/effectGraph';
import { effectOperatorParams } from '../operators/effectGraphOwner';
import { VOXEL_RELIEF_PARAMS } from '../../effects/stylize/voxel-relief/parameters';
import { compileScalarField } from '../operators/scalarField';
import { evaluateScalarField } from '../operators/evaluateScalarField';
import { voxelTextureMapping } from '../operators/voxelTextureMapping';
import { nodeScalarSampleTap } from './NodeScalarSampleTap';
import { scalarPreviewSamples } from './scalarPreviewSamples';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import type { PreviewFrame, PreviewRequest, PreviewValueControl } from './previewTypes';

/** Reads the actual effect input/output and sampled parameters; never starts a render. */
export async function voxelPreview(request: PreviewRequest, clip: TimelineClip, effect: Effect, keys: Keyframe[], time: number): Promise<PreviewFrame> {
  const base = { key: request.key, revision: request.revision, time: request.time };
  const binding = request.node.binding;
  const graph = voxelOperatorGraph(effect.params);
  const node = binding?.kind === 'effect-operator' && graph.nodes.find(value => value.id === binding.nodeId);
  if (!node) return { ...base, status: 'missing', label: 'Voxel node unavailable' };
  if (!operatorEnabled(node, effect.params)) return { ...base, status: 'missing', label: 'Node bypassed' };
  const evaluatedParams = effectOperatorParams(effect);
  const sample = (key: string) => sampleOperatorParameter(node, key, evaluatedParams, effect.id, keys, time);
  const controls = getEffectOperator(node.operator)!.parameters.flatMap(spec => {
    if (graph.edges.some(edge => edge.to === node.id && edge.input === spec.id)) return [];
    const binding = node.bindings[spec.id], value = sample(spec.id);
    if (typeof binding !== 'string' || (typeof value !== 'number' && typeof value !== 'boolean')) return [];
    const alias = VOXEL_RELIEF_PARAMS[binding];
    return [{ label: alias?.label ?? spec.label, value, defaultValue: alias?.default ?? spec.default,
      min: alias?.min ?? spec.min, max: alias?.max ?? spec.max, step: alias?.step ?? spec.step,
      portId: node.operator.startsWith('math.') ? spec.id === 'value' ? 'value' : spec.id : undefined,
      direction: spec.id === 'value' ? 'output' : 'input',
      target: { clipId: clip.id, effectId: effect.id, nodeId: node.id, parameter: spec.id },
    } as PreviewValueControl];
  });
  if (node.operator.startsWith('math.')) {
    const specs = getEffectOperator(node.operator)!.parameters;
    const connected = (id: string) => graph.edges.some(edge => edge.to === node.id && edge.input === id);
    const fixed = specs.filter(spec => !connected(spec.id));
    const label = (id: string, fallback: string) => { const binding = node.bindings[id]; return typeof binding === 'string' ? VOXEL_RELIEF_PARAMS[binding]?.label ?? fallback : fallback; };
    const parameter = (source: typeof node, key: string) => Number(sampleOperatorParameter(source, key, evaluatedParams, effect.id, keys, time));
    const enabled = (source: typeof node) => operatorEnabled(source, evaluatedParams);
    const program = compileScalarField(graph, node, parameter, enabled);
    let sampleValue: number | undefined = 0;
    if (program.textureNodeId) {
      const uv = voxelTextureMapping(graph, graph.nodes.find(source => source.id === program.textureNodeId), parameter, enabled);
      const grid = graph.nodes.find(source => source.operator === 'geometry.grid');
      const stage = clip.is3D ? `voxel-scene:${clip.id}` : `voxel-effect:${effect.id}`, columns = grid ? parameter(grid, 'columns') : 107.4;
      const sampleKey = uv && scalarPreviewSamples.key(clip.id, stage, uv, columns, !!clip.is3D);
      const refresh = uv && nodeScalarSampleTap.request(stage, clip.id, request.revision, uv, columns, !!clip.is3D);
      if (refresh && sampleKey) void refresh.then(sample => scalarPreviewSamples.publish(sampleKey, sample));
      const sampled = sampleKey && scalarPreviewSamples.read(sampleKey) || await refresh;
      sampleValue = sampled ? sampled[0] * 0.2126 + sampled[1] * 0.7152 + sampled[2] * 0.0722 : undefined;
    }
    const evaluated = sampleValue === undefined ? undefined : evaluateScalarField(program, sampleValue);
    const values: NonNullable<PreviewFrame['values']> = specs.filter(spec => connected(spec.id)).map(spec => {
      const edge = graph.edges.find(edge => edge.to === node.id && edge.input === spec.id)!;
      const index = program.nodeRegisters?.[edge.from];
      return { portId: spec.id, direction: 'input', value: index === undefined ? undefined : evaluated?.[index] };
    });
    if (node.operator !== 'math.constant') values.push({ portId: 'value', direction: 'output', value: evaluated?.[program.output] });
    return { ...base, controls, values, status: 'live', label: program.textureNodeId ? sampleValue === undefined ? 'Center cell unavailable' : 'Live · center cell' : 'Live values', drawing: { kind: 'number',
      value: fixed.length ? fixed.map(spec => Number(Number(sample(spec.id)).toFixed(4))).join(' / ') : 'ƒ',
      caption: fixed.length ? fixed.map(spec => label(spec.id, spec.label)).join(' / ') : 'Per-cell calculation',
      details: specs.filter(spec => connected(spec.id)).map(spec => `${spec.label}: connected`),
    } };
  }
  if (node.operator === 'render.voxel') return nodePreviewTextureTap.request(clip.is3D ? `scene:${clip.id}` : `effect:${effect.id}`, request);
  if (node.operator === 'image.frame') {
    const index = clip.effects.findIndex(value => value.id === effect.id);
    const upstream = clip.effects.slice(0, index).findLast(value => value.enabled && !value.type.startsWith('audio-'));
    return nodePreviewTextureTap.request(upstream ? `effect:${upstream.id}` : `color:${clip.id}`, request);
  }
  if (node.operator === 'material.surface') return { ...base, status: 'live', label: 'Surface material', drawing: { kind: 'material',
    color: ['red', 'green', 'blue'].map(key => Number(sample(key))), opacity: Number(sample('opacity')),
    textured: graph.edges.some(edge => edge.to === node.id && edge.input === 'texture') } };
  const specs = getEffectOperator(node.operator)!.parameters;
  return { ...base, controls, status: specs.length ? 'live' : 'missing', label: specs.length ? 'Evaluated parameters' : 'Inspect the connected relief render',
    ...(specs.length ? { drawing: { kind: 'text' as const, lines: specs.slice(0, 6).map(spec => `${spec.label}: ${sample(spec.id)}`) } } : {}) };
}

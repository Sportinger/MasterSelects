import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { flockRuntime } from '../../engine/flock/runtime/flockRuntimeApi';
import { createFlockAudioSampler } from '../../engine/flock/runtime/flockAudioSampler';
import { compileFlockDefinitionCached } from '../flock/compiler/flockCompiler';
import { evaluateFlockValues, indexFlockKeyframes, resolveBundle } from '../flock/compiler/flockParamEvaluation';
import { applyFlockLoop } from '../flock/time/flockTimeMapper';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import type { PreviewFrame, PreviewRequest } from './previewTypes';

/** Uses the existing compiler/runtime. A viewer never advances or restarts a simulation. */
export async function flockPreview(request: PreviewRequest, clip: TimelineClip, sourceTime: number, keys: readonly Keyframe[]): Promise<PreviewFrame> {
  const base = { key: request.key, revision: request.revision, time: request.time };
  const missing = (label: string): PreviewFrame => ({ ...base, status: 'missing', label });
  const binding = request.node.binding;
  const node = binding?.kind === 'flock-node' ? clip.flock?.nodes.find(value => value.id === binding.nodeId) : undefined;
  if (!clip.flock || !node) return missing('Flock node unavailable');
  if (node.bypassed) return missing('Node bypassed');
  const compilation = compileFlockDefinitionCached(clip.flock);
  if (!compilation.ok) return missing('Connect the required simulation inputs');
  const program = compilation.program;
  const semantic = request.port?.metadata?.semanticKind;
  if (request.port?.type === 'time') return { ...base, status: 'live', label: 'Source time', drawing: { kind: 'text', lines: [`${sourceTime.toFixed(3)} s`] } };
  if (semantic === 'flock:scene' || (node.operator === 'flock.output' && request.port?.type === 'geometry')) {
    // The native scene exposes one shared render, not a separate per-branch image.
    const frame = await nodePreviewTextureTap.request(`scene:${clip.id}`, request);
    return { ...frame, label: frame.status === 'missing' ? frame.label : 'Shared Flock scene' };
  }
  if (semantic === 'flock:particles') {
    const status = flockRuntime.getStatus(clip.id);
    if (!status || status.hashes?.topology !== program.hashes.topology || status.hashes.behavior !== program.hashes.behavior) return missing('Simulation has not rendered this graph');
    const sample = await flockRuntime.sampleParticles(clip.id, 128);
    if (!sample) return missing('Particle sample unavailable');
    const points: number[] = [];
    for (let i = 0; i + 7 < sample.values.length && points.length < 384; i += 8) {
      if (sample.values[i + 6] >= 0 && sample.values.slice(i, i + 3).every(Number.isFinite)) points.push(...sample.values.slice(i, i + 3));
    }
    const current = status.cache.current && Math.abs(sample.sourceTime - sourceTime) <= 2 / program.stepRate;
    return { ...base, status: current ? 'live' : 'stale', label: current ? 'Particle sample' : 'Last simulated particles', drawing: { kind: 'points', dimensions: 3, points } };
  }
  const context = { keyframesByProperty: indexFlockKeyframes(keys), audio: createFlockAudioSampler(clip.id, { loadMissing: false }) };
  const time = applyFlockLoop(program, sourceTime);
  const evaluated = evaluateFlockValues(program, time, context);
  const valueIndex = program.values.findIndex(value => value.nodeId === node.id);
  if (semantic === 'flock:scalar' && valueIndex >= 0) {
    if (evaluated.unavailableAudioClipIds.length) return missing('Referenced audio analysis unavailable');
    return { ...base, status: 'live', label: 'Scalar output', drawing: { kind: 'text', lines: [String(Number(evaluated.values[valueIndex].toFixed(4)))] } };
  }
  const spec = [program.simulation, ...program.emitters, ...program.ops, ...program.paths, ...program.obstacles,
    ...program.palettes, ...program.branches, ...program.selections, ...program.trails, program.boundary].find(value => value?.nodeId === node.id);
  if (!spec) return missing(node.groupRef ? 'Expand the group parameters to inspect its values'
    : node.operator === 'flock.compose' ? 'Combined behavior; inspect its connected inputs' : 'No evaluated parameters for this node');
  if (semantic === 'flock:curves') return missing('Curve geometry is not retained for node previews');
  const resolved = resolveBundle(spec.params, time, evaluated.values, context);
  const values = Object.values(resolved).flatMap(value => Object.entries(value));
  return { ...base, status: 'live', label: 'Evaluated parameters', drawing: { kind: 'text', lines: values.slice(0, 6).map(([key, value]) =>
    `${key}: ${Array.isArray(value) ? value.map(number => Number(number.toFixed(2))).join(', ') : String(value).slice(0, 40)}`) } };
}

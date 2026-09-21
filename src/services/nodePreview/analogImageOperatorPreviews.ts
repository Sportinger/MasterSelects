import type { AnalogImagePreviewInputs } from '../../effects/analog/signal-lab/AnalogSignalRuntime';
import { compileAnalogSignalPreview, type AnalogSignalStage } from '../operators/analogSignalGraph';
import { compileImageOperatorPreview } from '../operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import { analogSignalPreviewPrefix, parseAnalogSignalPreviewStage } from './analogSignalPreviewStages';
import { Logger } from '../logger';

const log = Logger.create('AnalogImagePreviews');
const reportedFailures = new Set<string>();

type AnalogEffect = { id: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };
interface Output { texture: GPUTexture; view: GPUTextureView; width: number; height: number }
interface State { device: GPUDevice; outputs: Map<string, Output> }
const hot = import.meta.hot?.data as { analogImagePreviewState?: State } | undefined;
let state = hot?.analogImagePreviewState;
if (import.meta.hot) import.meta.hot.dispose(data => { data.analogImagePreviewState = state; });

function outputFor(device: GPUDevice, key: string, width: number, height: number) {
  if (state?.device !== device) {
    for (const output of state?.outputs.values() ?? []) output.texture.destroy();
    state = { device, outputs: new Map() }; const owner = state;
    void device.lost.then(() => { if (state === owner) { for (const output of owner.outputs.values()) output.texture.destroy(); state = undefined; } });
  }
  const found = state.outputs.get(key);
  if (found?.width === width && found.height === height) { state.outputs.delete(key); state.outputs.set(key, found); return found; }
  if (found) state.outputs.delete(key); // Recorded command buffers retain the old texture; dropping the cache reference is submission-safe.
  const texture = device.createTexture({ label: `analog-node-preview-${key}`, size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const output = { texture, view: texture.createView(), width, height }; state.outputs.set(key, output);
  if (state.outputs.size > 8) state.outputs.delete(state.outputs.keys().next().value!);
  return output;
}

/** Encodes demanded flat-island previews through the canonical image compiler and analog compute adapter. */
export function captureAnalogImageOperatorPreviews(options: {
  effect: AnalogEffect; stage: AnalogSignalStage | undefined; inputs: AnalogImagePreviewInputs;
  device: GPUDevice; encoder: GPUCommandEncoder; sampler: GPUSampler;
}): number {
  const compilation = options.stage?.imagePreview;
  const demands = nodePreviewTextureTap.matching(analogSignalPreviewPrefix(options.effect.id));
  if (!demands.length) return 0;
  let captured = 0;
  for (const { stage } of demands) {
    const target = parseAnalogSignalPreviewStage(stage); if (!target) continue;
    const targetNode = compilation?.graph.nodes.find(node => node.id === target.nodeId);
    // The regular stage callback captures these exact final textures after the programmed resolve.
    if (targetNode && (targetNode.operator === 'image.output' || (target.nodeId === options.stage?.nodeId && target.direction === 'output'))) continue;
    try {
      const specialized = (!targetNode || !compilation) && options.effect.operatorGraph
        ? compileAnalogSignalPreview(options.effect.operatorGraph, options.effect.params, target) : undefined;
      if (!targetNode && !specialized) continue;
      const program = specialized?.program
        ?? compileImageOperatorPreview(compilation!.graph, compilation!.params, target, compilation!.context);
      if (program.passes?.length) throw new Error('Analog node previews do not support multi-pass image programs.');
      const output = outputFor(options.device, `${options.effect.id}:${stage}`, options.inputs.width, options.inputs.height);
      if (specialized) options.inputs.encodePlan(specialized.plan, specialized.stage, program, output.view, stage);
      else options.inputs.encode!(program, output.view);
      nodePreviewTextureTap.capture(stage, options.device, options.encoder, options.sampler, output.view, options.inputs.width, options.inputs.height);
      reportedFailures.delete(stage);
      captured++;
    } catch (error) {
      if (!reportedFailures.has(stage)) {
        if (reportedFailures.size >= 32) reportedFailures.clear();
        reportedFailures.add(stage); log.warn(`Unable to capture Analog image preview ${target.nodeId}:${target.portId}`, error);
      }
    }
  }
  return captured;
}

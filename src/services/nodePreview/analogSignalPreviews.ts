import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { PreviewFrame, PreviewRequest } from './previewTypes';
import { effectOperatorGraph } from '../operators/effectGraphOwner';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import { analogSignalPreviewLabel, analogSignalPreviewPrefix, analogSignalPreviewStage, parseAnalogSignalPreviewStage, type AnalogSignalPreviewTarget } from './analogSignalPreviewStages';

type AnalogEffect = { id: string; type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };
type CapturableStage = 'encode' | 'rf' | 'vhs' | 'decode' | 'resolve';

/** Resolves UI aliases to the node whose runtime texture actually supplies them. */
export function analogSignalPreviewProducerNode(graph: EffectOperatorGraph, target: AnalogSignalPreviewTarget): string | undefined {
  const incoming = (nodeId: string, portId?: string) => graph.edges.find(edge => edge.to === nodeId && (!portId || edge.input === portId));
  const followBypass = (nodeId: string | undefined): string | undefined => {
    const node = graph.nodes.find(candidate => candidate.id === nodeId); if (!node) return;
    if (!node.bypassed) return node.id;
    const bypassInput = node.operator === 'analog.display-resolve' ? 'source' : 'signal';
    return followBypass(incoming(node.id, bypassInput)?.from);
  };
  const targetNode = graph.nodes.find(node => node.id === target.nodeId); if (!targetNode) return;
  if (targetNode.operator === 'image.output') return followBypass(incoming(targetNode.id, 'image')?.from ?? incoming(targetNode.id)?.from);
  if (target.direction === 'input') return followBypass(incoming(targetNode.id, target.portId)?.from);
  return followBypass(targetNode.id);
}

export function analogSignalNodePreview(request: PreviewRequest, effect: AnalogEffect): PreviewFrame | Promise<PreviewFrame> | undefined {
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator' || !request.port) return;
  const signal = request.port.metadata?.semanticKind?.replace(/^operator:/, '');
  const base = { key: request.key, revision: request.revision, time: request.time };
  if (signal === 'pal-signal') return { ...base, status: 'missing', label: 'PAL composite diagnostic preview unavailable',
    drawing: { kind: 'text', lines: ['864×313 RGBA16F composite signal', 'Open a decoded image output to inspect pixels.'] } };
  if (signal === 'receiver-lines') return { ...base, status: 'missing', label: 'Receiver analysis is metadata',
    drawing: { kind: 'text', lines: ['313 line-state records', 'No image texture is produced by this stage.'] } };
  if (signal !== 'image') return;
  const stage = analogSignalPreviewStage({ effectId: effect.id, nodeId: binding.nodeId, portId: request.port.id, direction: request.port.direction });
  return nodePreviewTextureTap.request(stage, request).then(frame => frame.status === 'live'
    ? { ...frame, label: analogSignalPreviewLabel(binding.operator, request.port!.direction) } : frame);
}

export interface CaptureAnalogSignalStagePreviewsOptions {
  effect: AnalogEffect;
  nodeId: string;
  kind: CapturableStage;
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  sampler: GPUSampler;
  view: GPUTextureView;
  width: number;
  height: number;
}

/** Captures decoded/resolved textures only when a matching node viewer is waiting. */
export function captureAnalogSignalStagePreviews(options: CaptureAnalogSignalStagePreviewsOptions): number {
  if (options.kind !== 'decode' && options.kind !== 'resolve') return 0;
  const demands = nodePreviewTextureTap.matching(analogSignalPreviewPrefix(options.effect.id));
  if (!demands.length) return 0;
  const graph = effectOperatorGraph(options.effect);
  let captured = 0;
  for (const { stage } of demands) {
    const target = parseAnalogSignalPreviewStage(stage); if (!target) continue;
    if (analogSignalPreviewProducerNode(graph, target) !== options.nodeId) continue;
    nodePreviewTextureTap.capture(stage, options.device, options.encoder, options.sampler, options.view, options.width, options.height);
    captured++;
  }
  return captured;
}

import type { Effect } from '../../types/effects';
import type { PreviewFrame, PreviewRequest } from './previewTypes';
import { readAudioOperatorGraph } from '../operators/audioOperatorGraph';

export function audioOperatorPreview(request: PreviewRequest, effect: Effect): PreviewFrame {
  const graph = readAudioOperatorGraph(effect.params.operatorGraph);
  const binding = request.node.binding;
  const node = binding?.kind === 'effect-operator' ? graph.nodes.find(node => node.id === binding.nodeId) : undefined;
  const base = { key: request.key, revision: request.revision, time: request.time };
  if (node?.operator !== 'values.number') return { ...base, status: 'missing', label: 'Audio samples',
    presentation: 'text', drawing: { kind: 'text', lines: ['Per-sample audio'] } };
  const value = Number(node.constants?.value ?? 1);
  return { ...base, status: 'live', label: 'Value', values: [{ portId: 'value', direction: 'output', value }],
    controls: [{ label: 'Value', value, defaultValue: 1, min: Math.min(-30, value), max: Math.max(30, value), step: 0.01,
      portId: 'value', direction: 'output', target: { clipId: request.clipId, effectId: effect.id, nodeId: node.id, parameter: 'value', storage: 'constant' } }],
    drawing: { kind: 'number', value: String(value), caption: 'Value' } };
}

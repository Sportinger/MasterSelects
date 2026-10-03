import type { FullscreenEffectDefinition } from '../../types';
import { edgeFillArtifacts } from './edgeFillArtifacts';
import shader from './shader.wgsl?raw';
import { EDGE_FILL_PROMPT } from './edgeFillPrompt';

export const aiEdgeFill: FullscreenEffectDefinition = {
  id: 'ai-edge-fill', name: 'AI Edge Fill', category: 'distort',
  shader, entryPoint: 'aiEdgeFillFragment', uniformSize: 48,
  params: {
    mix: { type: 'number', label: 'Fill Opacity', default: 100, min: 0, max: 100, step: .1, animatable: true, hidden: true },
    seamBlend: { type: 'number', label: 'Seam Blend', default: 12, min: 0, max: 64, step: 1, animatable: true, hidden: true },
    canvasWidth: { type: 'number', label: 'Canvas Width', default: 0, hidden: true, animatable: false },
    prompt: { type: 'text', label: 'Prompt', default: EDGE_FILL_PROMPT, hidden: true },
    resolution: { type: 'select', label: 'Generation Size', default: '2K', hidden: true,
      options: ['1K', '2K', '4K'].map(value => ({ value, label: value })) },
    artifactId: { type: 'text', label: 'Fill Artifact', default: '', hidden: true },
    sourceSignature: { type: 'text', label: 'Source Version', default: '', hidden: true },
    taskId: { type: 'text', label: 'Pending Task', default: '', hidden: true },
    taskSignature: { type: 'text', label: 'Pending Source Version', default: '', hidden: true },
    requestId: { type: 'text', label: 'Pending Request', default: '', hidden: true },
    requestSignature: { type: 'text', label: 'Request Source Version', default: '', hidden: true },
    canvasSpace: { type: 'boolean', label: 'Full Canvas Fill', default: false, hidden: true },
  },
  byteTexture: params => edgeFillArtifacts.get(String(params.artifactId || '')),
  packUniforms: (params, width) => new Float32Array([
    typeof params.mix === 'number' && Number.isFinite(params.mix) ? Math.max(0, Math.min(100, params.mix)) / 100 : 1,
    edgeFillArtifacts.get(String(params.artifactId || '')) ? 1 : 0, params.canvasSpace === true ? 1 : 0,
    Math.max(0, Math.min(64, Number(params.seamBlend ?? 12) || 0)) / Math.max(1, Number(params.canvasWidth) || width),
    Number(params.placement0 ?? 1), Number(params.placement1 ?? 0), Number(params.placement2 ?? 0), 0,
    Number(params.placement3 ?? 0), Number(params.placement4 ?? 1), Number(params.placement5 ?? 0), 0,
  ]),
  extraControls: () => import('./AiEdgeFillControls'),
};

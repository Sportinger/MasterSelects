import type { FullscreenEffectDefinition } from '../../types';
import { edgeFillArtifacts } from './edgeFillArtifacts';
import shader from './shader.wgsl?raw';
import { DEFAULT_EDGE_FILL_SCENE } from './edgeFillPrompt';

/** Captured canvas placement; a missing or non-numeric entry falls back to identity instead of NaN (a black frame). */
const placement = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const aiEdgeFill: FullscreenEffectDefinition = {
  id: 'ai-edge-fill', name: 'AI Edge Fill', category: 'distort',
  shader, entryPoint: 'aiEdgeFillFragment', uniformSize: 48,
  params: {
    mix: { type: 'number', label: 'Fill Opacity', default: 100, min: 0, max: 100, step: .1, animatable: true, hidden: true },
    seamBlend: { type: 'number', label: 'Seam Blend', default: 12, min: 0, max: 64, step: 1, animatable: true, hidden: true },
    canvasWidth: { type: 'number', label: 'Canvas Width', default: 0, hidden: true, animatable: false },
    // What the fill continues, in plain words; the card's Scene field. edgeFillPrompt.ts wraps it in the fixed request.
    scene: { type: 'text', label: 'Scene', default: DEFAULT_EDGE_FILL_SCENE, hidden: true },
    // A full request written by hand in an earlier version, sent as it was; empty (new effects) or an old default uses Scene.
    prompt: { type: 'text', label: 'Prompt', default: '', hidden: true },
    resolution: { type: 'select', label: 'Resolution', default: '2K', hidden: true,
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
    placement(params.placement0, 1), placement(params.placement1, 0), placement(params.placement2, 0), 0,
    placement(params.placement3, 0), placement(params.placement4, 1), placement(params.placement5, 0), 0,
  ]),
  extraControls: () => import('./AiEdgeFillControls'),
};

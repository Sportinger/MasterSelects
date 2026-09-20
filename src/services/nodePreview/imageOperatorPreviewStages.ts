import type { NodeGraphPort } from '../../types/nodeGraph';

const PREFIX = 'image-node:';
const TEXTURE_SIGNALS = new Set(['image', 'rgb', 'alpha', 'number', 'vec2', 'vec3', 'vec4']);

export interface ImageOperatorPreviewTarget {
  effectId: string;
  nodeId: string;
  portId: string;
  direction: NodeGraphPort['direction'];
}

const part = (value: string) => encodeURIComponent(value);

/** Shared UI/render stage contract. A stage exists only while the viewer has an active demand. */
export function imageOperatorPreviewStage(target: ImageOperatorPreviewTarget): string {
  return `${PREFIX}${part(target.effectId)}:${part(target.nodeId)}:${target.direction}:${part(target.portId)}`;
}

export function imageOperatorPreviewPrefix(effectId: string): string {
  return `${PREFIX}${part(effectId)}:`;
}

export function isImageOperatorTextureSignal(semanticKind: string | undefined): boolean {
  return semanticKind?.startsWith('operator:') === true && TEXTURE_SIGNALS.has(semanticKind.slice(9));
}

export function parseImageOperatorPreviewStage(stage: string): ImageOperatorPreviewTarget | undefined {
  if (!stage.startsWith(PREFIX)) return undefined;
  const [effectId, nodeId, direction, portId, ...rest] = stage.slice(PREFIX.length).split(':');
  if (!effectId || !nodeId || !portId || rest.length || (direction !== 'input' && direction !== 'output')) return undefined;
  try {
    return { effectId: decodeURIComponent(effectId), nodeId: decodeURIComponent(nodeId), direction, portId: decodeURIComponent(portId) };
  } catch { return undefined; }
}

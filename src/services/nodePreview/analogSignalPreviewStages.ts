import type { NodeGraphPort } from '../../types/nodeGraph';

const PREFIX = 'analog-node:';
export interface AnalogSignalPreviewTarget {
  effectId: string;
  nodeId: string;
  portId: string;
  direction: NodeGraphPort['direction'];
}
const part = (value: string) => encodeURIComponent(value);

/** Stable UI/runtime demand identity; no stage texture is retained here. */
export function analogSignalPreviewStage(target: AnalogSignalPreviewTarget): string {
  return `${PREFIX}${part(target.effectId)}:${part(target.nodeId)}:${target.direction}:${part(target.portId)}`;
}
export const analogSignalPreviewPrefix = (effectId: string) => `${PREFIX}${part(effectId)}:`;
export function parseAnalogSignalPreviewStage(stage: string): AnalogSignalPreviewTarget | undefined {
  if (!stage.startsWith(PREFIX)) return;
  const [effectId, nodeId, direction, portId, ...rest] = stage.slice(PREFIX.length).split(':');
  if (!effectId || !nodeId || !portId || rest.length || (direction !== 'input' && direction !== 'output')) return;
  try { return { effectId: decodeURIComponent(effectId), nodeId: decodeURIComponent(nodeId), direction, portId: decodeURIComponent(portId) }; }
  catch { return; }
}

export function analogSignalPreviewLabel(operator: string, direction: NodeGraphPort['direction']): string {
  if (operator === 'image.output') return 'Final Analog Signal output';
  if (operator === 'analog.pal-decode') return direction === 'output' ? 'PAL decoded image' : 'PAL decoder input';
  if (operator === 'analog.display-resolve') return direction === 'output' ? 'Display-resolved image' : 'Display input';
  return 'Analog Signal stage output';
}

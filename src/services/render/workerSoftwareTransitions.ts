import type { Layer } from '../../types';
import type { WorkerRenderSoftwareTransition } from './workerRenderHostRuntimeCommands';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampedProgress(value: number | undefined): number {
  return Math.max(0, Math.min(1, finiteNumber(value, 0)));
}

export function workerSoftwareTransitionFromLayer(layer: Layer): WorkerRenderSoftwareTransition | null {
  const transition = layer.transitionRender;
  if (!transition) return null;
  switch (transition.kind) {
    case 'wipe':
      return {
        kind: 'wipe',
        direction: transition.direction,
        progress: clampedProgress(transition.progress),
      };
    case 'soft-wipe':
      return {
        kind: 'wipe',
        direction: transition.direction,
        progress: clampedProgress(transition.progress),
      };
    case 'shape-mask':
      return {
        kind: 'shape-mask',
        shape: transition.shape,
        progress: clampedProgress(transition.progress),
      };
    case 'center-mask':
      return {
        kind: 'center-mask',
        axis: transition.axis,
        progress: clampedProgress(transition.progress),
      };
    case 'clock-mask':
      return {
        kind: 'clock-mask',
        progress: clampedProgress(transition.progress),
      };
    case 'procedural-mask':
      return {
        kind: 'procedural-mask',
        procedural: transition.procedural,
        progress: clampedProgress(transition.progress),
        seed: finiteNumber(transition.seed, 0),
      };
    case 'pattern-mask':
      return {
        kind: 'pattern-mask',
        pattern: transition.pattern,
        progress: clampedProgress(transition.progress),
      };
    default:
      return null;
  }
}

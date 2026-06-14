import type { Layer, TimelineClip } from '../../types';
import type {
  TransitionParticipantRole,
  TransitionPlan,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { createTransitionSourceClip } from '../../stores/timeline/editOperations/transitionPlanner';
import type { TransitionCurve, TransitionPrimitive } from '../../transitions';

type BuildTransitionClipLayer = (
  clip: TimelineClip,
  role: TransitionParticipantRole,
  opacity: number
) => Layer | null;

export interface AssembleTransitionLayersInput {
  plan: TransitionPlan;
  playheadPosition: number;
  trackIndex: number;
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  buildClipLayer: BuildTransitionClipLayer;
}

const solidCanvasCache = new Map<string, HTMLCanvasElement>();

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function ease(progress: number, curve: TransitionCurve | undefined): number {
  if (curve === 'ease-in') return progress * progress;
  if (curve === 'ease-out') return 1 - (1 - progress) * (1 - progress);
  if (curve === 'ease-in-out') {
    return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) * 0.5;
  }
  return progress;
}

function evaluateOpacity(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  progress: number,
): number {
  let opacity = 1;

  for (const primitive of recipe) {
    if (primitive.kind !== 'opacity' || primitive.target !== target) continue;

    const start = primitive.startProgress ?? 0;
    const end = primitive.endProgress ?? 1;
    if (progress <= start) {
      opacity = primitive.from;
    } else if (progress >= end) {
      opacity = primitive.to;
    } else {
      opacity = lerp(
        primitive.from,
        primitive.to,
        ease(clamp01((progress - start) / Math.max(0.0001, end - start)), primitive.curve)
      );
    }
  }

  return clamp01(opacity);
}

function getWipePrimitive(recipe: readonly TransitionPrimitive[]): Extract<TransitionPrimitive, { kind: 'mask' }> | undefined {
  return recipe.find((primitive): primitive is Extract<TransitionPrimitive, { kind: 'mask' }> =>
    primitive.kind === 'mask' && primitive.mask === 'wipe'
  );
}

function getSolidPrimitive(recipe: readonly TransitionPrimitive[]): Extract<TransitionPrimitive, { kind: 'solid' }> | undefined {
  return recipe.find((primitive): primitive is Extract<TransitionPrimitive, { kind: 'solid' }> =>
    primitive.kind === 'solid'
  );
}

function getSolidCanvas(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cached = solidCanvasCache.get(color);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  solidCanvasCache.set(color, canvas);
  return canvas;
}

function createSolidLayer(
  color: string,
  plan: TransitionPlan,
  trackIndex: number,
): Layer | null {
  const canvas = getSolidCanvas(color);
  if (!canvas) return null;

  return {
    id: `transition:${plan.transitionType}:${plan.outgoing.clipId}:${plan.incoming.clipId}:solid:${trackIndex}`,
    name: `${plan.definition.name} Solid`,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'solid',
      textCanvas: canvas,
      color,
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

function withTransitionLayerId(
  layer: Layer,
  plan: TransitionPlan,
  role: TransitionParticipantRole,
  clipId: string,
  trackIndex: number,
): Layer {
  return {
    ...layer,
    id: `transition:${plan.transitionType}:${plan.outgoing.clipId}:${plan.incoming.clipId}:${role}:${clipId}:${trackIndex}`,
  };
}

export function assembleTransitionLayers({
  plan,
  playheadPosition,
  trackIndex,
  outgoingClip,
  incomingClip,
  buildClipLayer,
}: AssembleTransitionLayersInput): Layer[] {
  const duration = Math.max(0.0001, plan.bodyEnd - plan.bodyStart);
  const progress = clamp01((playheadPosition - plan.bodyStart) / duration);
  const recipe = plan.definition.recipe;
  const wipe = getWipePrimitive(recipe);

  const outgoingSourceClip = createTransitionSourceClip(outgoingClip, plan.outgoing, playheadPosition);
  const incomingSourceClip = createTransitionSourceClip(incomingClip, plan.incoming, playheadPosition);

  const incomingLayer = buildClipLayer(
    incomingSourceClip,
    'incoming',
    evaluateOpacity(recipe, 'incoming', progress)
  );
  const outgoingLayer = buildClipLayer(
    outgoingSourceClip,
    'outgoing',
    evaluateOpacity(recipe, 'outgoing', progress)
  );
  const solid = getSolidPrimitive(recipe);
  const solidLayer = solid ? createSolidLayer(solid.color, plan, trackIndex) : null;

  const layers: Layer[] = [];

  if (incomingLayer) {
    layers.push({
      ...withTransitionLayerId(incomingLayer, plan, 'incoming', incomingClip.id, trackIndex),
      ...(wipe && wipe.target === 'incoming'
        ? { transitionRender: { kind: 'wipe' as const, direction: wipe.direction, progress } }
        : {}),
    });
  }

  if (outgoingLayer) {
    layers.push({
      ...withTransitionLayerId(outgoingLayer, plan, 'outgoing', outgoingClip.id, trackIndex),
      ...(wipe && wipe.target === 'outgoing'
        ? { transitionRender: { kind: 'wipe' as const, direction: wipe.direction, progress } }
        : {}),
    });
  }

  if (solidLayer) {
    layers.push(solidLayer);
  }

  return layers;
}

export const assemblePreviewTransitionLayers = assembleTransitionLayers;

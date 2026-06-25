import type { Layer, TimelineClip } from '../../types';
import type {
  TransitionParticipantRole,
  TransitionPlan,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { createTransitionSourceClip } from '../../stores/timeline/editOperations/transitionPlanner';
import type { TransitionCurve, TransitionLayerTarget, TransitionPrimitive } from '../../transitions';
import { getTransitionParamValue } from '../../transitions';
import {
  getTransitionOverlayCanvas,
  type TransitionOverlayCanvasSize,
} from './transitionOverlayCanvases';
import { createTransitionMultiPanelLayers } from './transitionMultiPanelLayers';

type MaskPrimitive = Extract<TransitionPrimitive, { kind: 'mask' }>;
type EffectPrimitive = Extract<TransitionPrimitive, { kind: 'effect' }>;
type BlendPrimitive = Extract<TransitionPrimitive, { kind: 'blend' }>;
type OverlayPrimitive = Extract<TransitionPrimitive, { kind: 'overlay' }>;
type DistortionPrimitive = Extract<TransitionPrimitive, { kind: 'distortion' }>;
type MultiPanelPrimitive = Extract<TransitionPrimitive, { kind: 'multi-panel' }>;
type TransitionEffectInstance = Layer['effects'][number];

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
  outputSize?: TransitionOverlayCanvasSize;
}

const solidCanvasCache = new Map<string, HTMLCanvasElement>();
const DEFAULT_SOLID_CANVAS_SIZE: TransitionOverlayCanvasSize = { width: 512, height: 288 };

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
  target: TransitionLayerTarget,
  progress: number,
): number {
  const primitives = recipe
    .filter((primitive): primitive is Extract<TransitionPrimitive, { kind: 'opacity' }> =>
      primitive.kind === 'opacity' && primitive.target === target
    )
    .toSorted((a, b) => (a.startProgress ?? 0) - (b.startProgress ?? 0));
  if (primitives.length === 0) return 1;

  let opacity = primitives[0]?.from ?? 1;
  for (const primitive of primitives) {
    const start = primitive.startProgress ?? 0;
    const end = primitive.endProgress ?? 1;
    if (progress < start) {
      return clamp01(opacity);
    }
    if (progress >= end) {
      opacity = primitive.to;
    } else {
      return clamp01(lerp(
        primitive.from,
        primitive.to,
        ease(clamp01((progress - start) / Math.max(0.0001, end - start)), primitive.curve)
      ));
    }
  }

  return clamp01(opacity);
}

function evaluatePrimitiveProgress(
  primitive: { startProgress?: number; endProgress?: number; curve?: TransitionCurve },
  progress: number,
): number {
  const start = primitive.startProgress ?? 0;
  const end = primitive.endProgress ?? 1;
  if (progress <= start) return 0;
  if (progress >= end) return 1;
  return ease(clamp01((progress - start) / Math.max(0.0001, end - start)), primitive.curve);
}

function evaluateRange(
  range: { from: number; to: number } | undefined,
  primitive: { startProgress?: number; endProgress?: number; curve?: TransitionCurve },
  progress: number,
  fallback: number,
): number {
  if (!range) return fallback;
  return lerp(range.from, range.to, evaluatePrimitiveProgress(primitive, progress));
}

function addRotation(
  rotation: Layer['rotation'],
  rotateX: number,
  rotateY: number,
  rotateZ: number,
): Layer['rotation'] {
  if (typeof rotation === 'number') {
    if (rotateX === 0 && rotateY === 0) return rotation + rotateZ;
    return {
      x: rotateX,
      y: rotateY,
      z: rotation + rotateZ,
    };
  }

  return {
    x: rotation.x + rotateX,
    y: rotation.y + rotateY,
    z: rotation.z + rotateZ,
  };
}

function withTransitionTransform(
  layer: Layer,
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  progress: number,
): Layer {
  let position = layer.position;
  let scale = layer.scale;
  let rotation = layer.rotation;
  let changed = false;

  for (const primitive of recipe) {
    if (primitive.kind !== 'transform' || primitive.target !== target) continue;

    const translateX = evaluateRange(primitive.translateX, primitive, progress, 0);
    const translateY = evaluateRange(primitive.translateY, primitive, progress, 0);
    const translateZ = evaluateRange(primitive.translateZ, primitive, progress, 0);
    const rotateX = evaluateRange(primitive.rotateX, primitive, progress, 0);
    const rotateY = evaluateRange(primitive.rotateY, primitive, progress, 0);
    const scaleX = evaluateRange(primitive.scaleX, primitive, progress, 1);
    const scaleY = evaluateRange(primitive.scaleY, primitive, progress, 1);
    const rotateZ = evaluateRange(primitive.rotateZ, primitive, progress, 0);

    if (translateX !== 0 || translateY !== 0 || translateZ !== 0) {
      position = {
        x: position.x + translateX,
        y: position.y + translateY,
        z: position.z + translateZ,
      };
      changed = true;
    }

    if (scaleX !== 1 || scaleY !== 1) {
      scale = {
        ...scale,
        x: scale.x * scaleX,
        y: scale.y * scaleY,
      };
      changed = true;
    }

    if (rotateX !== 0 || rotateY !== 0 || rotateZ !== 0) {
      rotation = addRotation(rotation, rotateX, rotateY, rotateZ);
      changed = true;
    }
  }

  if (!changed) return layer;

  return {
    ...layer,
    position: { ...position },
    scale: { ...scale },
    rotation: typeof rotation === 'number' ? rotation : { ...rotation },
  };
}

function isBlendPrimitiveActive(primitive: BlendPrimitive, progress: number): boolean {
  const start = primitive.startProgress ?? 0;
  const end = primitive.endProgress ?? 1;
  return progress >= start && progress < end;
}

function withTransitionBlend(
  layer: Layer,
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  progress: number,
): Layer {
  const primitive = recipe.find((candidate): candidate is BlendPrimitive =>
    candidate.kind === 'blend' &&
    candidate.target === target &&
    isBlendPrimitiveActive(candidate, progress)
  );

  if (!primitive) return layer;

  return {
    ...layer,
    blendMode: primitive.mode as Layer['blendMode'],
  };
}

function isTransitionNumberRange(value: EffectPrimitive['params'][string]): value is { from: number; to: number } {
  return typeof value === 'object' &&
    value !== null &&
    'from' in value &&
    'to' in value &&
    typeof value.from === 'number' &&
    typeof value.to === 'number';
}

function evaluateEffectParamValue(
  value: EffectPrimitive['params'][string],
  primitive: EffectPrimitive,
  progress: number,
): string | number | boolean {
  if (isTransitionNumberRange(value)) {
    return evaluateRange(value, primitive, progress, value.from);
  }

  return value;
}

function createTransitionEffectInstances(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  progress: number,
): TransitionEffectInstance[] {
  return recipe
    .filter((primitive): primitive is EffectPrimitive =>
      primitive.kind === 'effect' && primitive.target === target
    )
    .map((primitive, index) => {
      const params: Record<string, string | number | boolean> = {};
      for (const [paramId, value] of Object.entries(primitive.params)) {
        params[paramId] = evaluateEffectParamValue(value, primitive, progress);
      }

      return {
        id: `transition-effect:${primitive.effectType}:${target}:${index}`,
        name: primitive.effectName ?? primitive.effectType,
        type: primitive.effectType as TransitionEffectInstance['type'],
        enabled: true,
        params,
      };
    });
}

function withTransitionEffects(
  layer: Layer,
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  progress: number,
): Layer {
  const transitionEffects = createTransitionEffectInstances(recipe, target, progress);
  if (transitionEffects.length === 0) return layer;

  return {
    ...layer,
    effects: [
      ...layer.effects,
      ...transitionEffects,
    ],
  };
}

function getMaskPrimitive(recipe: readonly TransitionPrimitive[]): MaskPrimitive | undefined {
  return recipe.find((primitive): primitive is MaskPrimitive =>
    primitive.kind === 'mask'
  );
}

function getDistortionPrimitive(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
): DistortionPrimitive | undefined {
  return recipe.find((primitive): primitive is DistortionPrimitive =>
    primitive.kind === 'distortion' && primitive.target === target
  );
}

function getMultiPanelPrimitive(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
): MultiPanelPrimitive | undefined {
  return recipe.find((primitive): primitive is MultiPanelPrimitive =>
    primitive.kind === 'multi-panel' && primitive.target === target
  );
}

function createTransitionRenderState(
  mask: MaskPrimitive | undefined,
  distortion: DistortionPrimitive | undefined,
  target: 'outgoing' | 'incoming',
  progress: number,
  seed: number,
): Layer['transitionRender'] | undefined {
  if (distortion) {
    return {
      kind: 'distortion',
      distortion: distortion.distortion,
      progress: evaluatePrimitiveProgress(distortion, progress),
      seed,
    };
  }

  if (!mask || mask.target !== target) return undefined;

  if (mask.mask === 'wipe') {
    if (typeof mask.angle === 'number' || typeof mask.feather === 'number') {
      return {
        kind: 'soft-wipe',
        direction: mask.direction,
        progress,
        angle: mask.angle ?? 0,
        feather: mask.feather ?? 0.08,
      };
    }

    return {
      kind: 'wipe',
      direction: mask.direction,
      progress,
    };
  }

  if (mask.mask === 'shape') {
    return {
      kind: 'shape-mask',
      shape: mask.shape,
      progress,
    };
  }

  if (mask.mask === 'clock') {
    return {
      kind: 'clock-mask',
      progress,
      clockwise: mask.clockwise ?? true,
      angleOffset: mask.angleOffset ?? 0,
    };
  }

  if (mask.mask === 'procedural') {
    return {
      kind: 'procedural-mask',
      procedural: mask.procedural,
      progress,
      seed,
    };
  }

  if (mask.mask === 'pattern') {
    return {
      kind: 'pattern-mask',
      pattern: mask.pattern,
      progress,
    };
  }

  return {
    kind: 'center-mask',
    axis: mask.axis,
    progress,
  };
}

function getSolidPrimitive(recipe: readonly TransitionPrimitive[]): Extract<TransitionPrimitive, { kind: 'solid' }> | undefined {
  return recipe.find((primitive): primitive is Extract<TransitionPrimitive, { kind: 'solid' }> =>
    primitive.kind === 'solid'
  );
}

function getOverlayPrimitives(recipe: readonly TransitionPrimitive[]): OverlayPrimitive[] {
  return recipe.filter((primitive): primitive is OverlayPrimitive => primitive.kind === 'overlay');
}

function normalizeSolidCanvasSize(outputSize: TransitionOverlayCanvasSize | undefined): TransitionOverlayCanvasSize {
  return {
    width: Math.max(1, Math.round(outputSize?.width ?? DEFAULT_SOLID_CANVAS_SIZE.width)),
    height: Math.max(1, Math.round(outputSize?.height ?? DEFAULT_SOLID_CANVAS_SIZE.height)),
  };
}

function getSolidCanvas(color: string, outputSize: TransitionOverlayCanvasSize | undefined): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const size = normalizeSolidCanvasSize(outputSize);
  const cacheKey = `${color}:${size.width}x${size.height}`;
  const cached = solidCanvasCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  solidCanvasCache.set(cacheKey, canvas);
  return canvas;
}

function createSolidLayer(
  color: string,
  opacity: number,
  plan: TransitionPlan,
  trackIndex: number,
  outputSize: TransitionOverlayCanvasSize | undefined,
): Layer | null {
  const canvas = getSolidCanvas(color, outputSize);
  if (!canvas) return null;

  return {
    id: `transition:${plan.transitionType}:${plan.outgoing.clipId}:${plan.incoming.clipId}:solid:${trackIndex}`,
    name: `${plan.definition.name} Solid`,
    visible: true,
    opacity,
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

function createOverlayLayer(
  primitive: OverlayPrimitive,
  opacity: number,
  color: string,
  progress: number,
  plan: TransitionPlan,
  trackIndex: number,
  index: number,
  outputSize: TransitionOverlayCanvasSize | undefined,
): Layer | null {
  if (opacity <= 0.001) return null;

  const centerX = evaluateRange(primitive.centerX, primitive, progress, 0.5);
  const canvas = getTransitionOverlayCanvas({
    pattern: primitive.overlay,
    color,
    centerX,
    widthRatio: primitive.width ?? (primitive.overlay === 'light-sweep' ? 0.16 : 0.38),
    softness: primitive.softness ?? (primitive.overlay === 'light-sweep' ? 0.34 : 0.4),
    angle: primitive.angle ?? (primitive.overlay === 'light-sweep' ? -0.35 : 0.14),
    outputSize,
  });
  if (!canvas) return null;

  return {
    id: `transition:${plan.transitionType}:${plan.outgoing.clipId}:${plan.incoming.clipId}:overlay:${index}:${trackIndex}`,
    name: `${plan.definition.name} Overlay`,
    visible: true,
    opacity,
    blendMode: (primitive.blendMode ?? 'screen') as Layer['blendMode'],
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

function hasScene3DPanelSource(layer: Layer): boolean {
  const source = layer.source;
  return !!(
    source?.videoFrame ||
    source?.videoElement ||
    source?.imageElement ||
    source?.textCanvas
  );
}

function withTransitionRenderMode(layer: Layer, plan: TransitionPlan): Layer {
  if (plan.definition.renderMode !== 'scene-3d-panel') {
    return layer;
  }
  if (!hasScene3DPanelSource(layer)) {
    return layer;
  }

  return {
    ...layer,
    is3D: true,
  };
}

export function assembleTransitionLayers({
  plan,
  playheadPosition,
  trackIndex,
  outgoingClip,
  incomingClip,
  buildClipLayer,
  outputSize,
}: AssembleTransitionLayersInput): Layer[] {
  const duration = Math.max(0.0001, plan.bodyEnd - plan.bodyStart);
  const progress = clamp01((playheadPosition - plan.bodyStart) / duration);
  const recipe = plan.definition.recipe;
  const mask = getMaskPrimitive(recipe);
  const incomingDistortion = getDistortionPrimitive(recipe, 'incoming');
  const outgoingDistortion = getDistortionPrimitive(recipe, 'outgoing');
  const incomingMultiPanel = getMultiPanelPrimitive(recipe, 'incoming');
  const outgoingMultiPanel = getMultiPanelPrimitive(recipe, 'outgoing');
  const seedParam = getTransitionParamValue(
    { type: plan.transitionType, params: plan.params },
    plan.definition,
    'seed',
  );
  const transitionSeed = typeof seedParam === 'number' && Number.isFinite(seedParam)
    ? seedParam
    : 0;

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
  const solidColor = solid
    ? String(getTransitionParamValue(
        { type: plan.transitionType, params: plan.params },
        plan.definition,
        solid.colorParam ?? '',
      ) ?? solid.color)
    : '';
  const solidLayer = solid ? createSolidLayer(
    solidColor,
    evaluateOpacity(recipe, 'solid', progress),
    plan,
    trackIndex,
    outputSize,
  ) : null;
  const overlayLayers = getOverlayPrimitives(recipe)
    .map((primitive, index) => {
      const color = String(getTransitionParamValue(
        { type: plan.transitionType, params: plan.params },
        plan.definition,
        primitive.colorParam ?? '',
      ) ?? primitive.color);
      return createOverlayLayer(
        primitive,
        clamp01(evaluateRange(primitive.opacity, primitive, progress, 1)),
        color,
        progress,
        plan,
        trackIndex,
        index,
        outputSize,
      );
    })
    .filter((layer): layer is Layer => Boolean(layer));

  const layers: Layer[] = [
    // LayerCollector consumes this array in reverse; transition overlays must render last.
    ...overlayLayers,
  ];

  if (incomingLayer) {
    const incomingTransitionLayer = withTransitionEffects(
      withTransitionBlend(
        withTransitionTransform(
          withTransitionLayerId(incomingLayer, plan, 'incoming', incomingClip.id, trackIndex),
          recipe,
          'incoming',
          progress,
        ),
        recipe,
        'incoming',
        progress,
      ),
      recipe,
      'incoming',
      progress,
    );
    const transitionRender = createTransitionRenderState(mask, incomingDistortion, 'incoming', progress, transitionSeed);
    const layer = {
      ...withTransitionRenderMode(incomingTransitionLayer, plan),
      ...(transitionRender ? { transitionRender } : {}),
    };
    if (incomingMultiPanel) {
      layers.push(...createTransitionMultiPanelLayers({
        baseLayer: layer,
        primitive: incomingMultiPanel,
        progress: evaluatePrimitiveProgress(incomingMultiPanel, progress),
        seed: transitionSeed,
      }));
    } else {
      layers.push(layer);
    }
  }

  if (outgoingLayer) {
    const outgoingTransitionLayer = withTransitionEffects(
      withTransitionBlend(
        withTransitionTransform(
          withTransitionLayerId(outgoingLayer, plan, 'outgoing', outgoingClip.id, trackIndex),
          recipe,
          'outgoing',
          progress,
        ),
        recipe,
        'outgoing',
        progress,
      ),
      recipe,
      'outgoing',
      progress,
    );
    const transitionRender = createTransitionRenderState(mask, outgoingDistortion, 'outgoing', progress, transitionSeed);
    const layer = {
      ...withTransitionRenderMode(outgoingTransitionLayer, plan),
      ...(transitionRender ? { transitionRender } : {}),
    };
    if (outgoingMultiPanel) {
      layers.push(...createTransitionMultiPanelLayers({
        baseLayer: layer,
        primitive: outgoingMultiPanel,
        progress: evaluatePrimitiveProgress(outgoingMultiPanel, progress),
        seed: transitionSeed,
      }));
    } else {
      layers.push(layer);
    }
  }

  if (solidLayer) {
    layers.push(solidLayer);
  }
  return layers;
}

export const assemblePreviewTransitionLayers = assembleTransitionLayers;

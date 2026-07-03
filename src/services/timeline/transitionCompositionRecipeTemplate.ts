import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import type { Layer } from '../../types/layers';
import type { CompositionTimelineData, SerializableClip, SerializableMarker, TimelineClip, TransitionOverlayClipDefinition } from '../../types/timeline';
import type { TimelineTransition, TransitionCompositionLink } from '../../types/timelineCore';
import { getRuntimeTransition } from '../../transitions';
import type { TransitionLayerTarget, TransitionPrimitive } from '../../transitions';
import type { TransitionPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import { createTransitionMultiPanelLayerStates } from '../layerBuilder/transitionMultiPanelLayers';
import { buildMaskMaterializationFromRecipe } from './transitionCompositionMasks';
import { makeKeyframe, mergeGeneratedKeyframes, sliceGeneratedKeyframesForSegment } from './transitionCompositionKeyframes';
import { buildLinkedCoverageClips, getSerializableClip } from './transitionCompositionSourceClips';

const TRANSITION_TEMPLATE_VERSION = 2;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function getTransitionParamString(
  transition: TimelineTransition,
  paramId: string | undefined,
  fallback: string,
): string {
  const value = paramId ? transition.params?.[paramId] : undefined;
  return typeof value === 'string' ? value : fallback;
}

export function resolveTransitionColor(
  transition: TimelineTransition,
  color: string,
  colorParam: string | undefined,
): string {
  return getTransitionParamString(transition, colorParam, color);
}

export function getTransitionTemplateParamsKey(
  transition: TimelineTransition,
  _outgoingClip: TimelineClip,
  _incomingClip: TimelineClip,
): string {
  return JSON.stringify({
    params: Object.entries(transition.params ?? {}).toSorted(([a], [b]) => a.localeCompare(b)),
  });
}

export function buildOpacityKeyframesFromRecipe(
  recipe: readonly TransitionPrimitive[],
  target: TransitionLayerTarget,
  clipId: string,
  duration: number,
): Keyframe[] {
  const keyframes = recipe
    .filter((primitive): primitive is Extract<TransitionPrimitive, { kind: 'opacity' }> =>
      primitive.kind === 'opacity' && primitive.target === target
    )
    .flatMap((primitive, index) => {
      const start = Math.max(0, Math.min(1, primitive.startProgress ?? 0)) * duration;
      const end = Math.max(0, Math.min(1, primitive.endProgress ?? 1)) * duration;
      const easing = primitive.curve ?? 'linear';
      return [
        {
          ...makeKeyframe(clipId, 'opacity', start, primitive.from, easing),
          id: `${clipId}:kf:opacity:${index}:start`,
        },
        {
          ...makeKeyframe(clipId, 'opacity', Math.max(start, end), primitive.to, easing),
          id: `${clipId}:kf:opacity:${index}:end`,
        },
      ];
    });
  return keyframes;
}

export function isTransitionNumberRange(value: unknown): value is { from: number; to: number } {
  return typeof value === 'object' &&
    value !== null &&
    'from' in value &&
    'to' in value &&
    typeof (value as { from?: unknown }).from === 'number' &&
    typeof (value as { to?: unknown }).to === 'number';
}

export function addRangeKeyframes(
  keyframes: Keyframe[],
  clipId: string,
  property: Keyframe['property'],
  duration: number,
  range: { from: number; to: number } | undefined,
  primitive: { startProgress?: number; endProgress?: number; curve?: Keyframe['easing'] },
  mapValue: (value: number) => number,
): void {
  if (!range) return;
  const start = Math.max(0, Math.min(1, primitive.startProgress ?? 0)) * duration;
  const end = Math.max(0, Math.min(1, primitive.endProgress ?? 1)) * duration;
  const easing = primitive.curve ?? 'linear';
  keyframes.push(makeKeyframe(clipId, property, start, mapValue(range.from), easing));
  keyframes.push(makeKeyframe(clipId, property, Math.max(start, end), mapValue(range.to), easing));
}

export function buildTransformKeyframesFromRecipe(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  clip: SerializableClip,
  duration: number,
): Keyframe[] {
  const keyframes: Keyframe[] = [];
  for (const primitive of recipe) {
    if (primitive.kind !== 'transform' || primitive.target !== target) continue;

    addRangeKeyframes(keyframes, clip.id, 'position.x', duration, primitive.translateX, primitive, value => clip.transform.position.x + value);
    addRangeKeyframes(keyframes, clip.id, 'position.y', duration, primitive.translateY, primitive, value => clip.transform.position.y + value);
    addRangeKeyframes(keyframes, clip.id, 'position.z', duration, primitive.translateZ, primitive, value => (clip.transform.position.z ?? 0) + value);
    addRangeKeyframes(keyframes, clip.id, 'scale.x', duration, primitive.scaleX, primitive, value => clip.transform.scale.x * value);
    addRangeKeyframes(keyframes, clip.id, 'scale.y', duration, primitive.scaleY, primitive, value => clip.transform.scale.y * value);
    addRangeKeyframes(keyframes, clip.id, 'rotation.x', duration, primitive.rotateX, primitive, value => clip.transform.rotation.x + value);
    addRangeKeyframes(keyframes, clip.id, 'rotation.y', duration, primitive.rotateY, primitive, value => clip.transform.rotation.y + value);
    addRangeKeyframes(keyframes, clip.id, 'rotation.z', duration, primitive.rotateZ, primitive, value => clip.transform.rotation.z + value);
  }
  return keyframes;
}

export function buildEffectMaterializationFromRecipe(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  clipId: string,
  duration: number,
): { effects: Effect[]; keyframes: Keyframe[] } {
  const effects: Effect[] = [];
  const keyframes: Keyframe[] = [];
  recipe.forEach((primitive, index) => {
    if (primitive.kind !== 'effect' && primitive.kind !== 'distortion') return;
    if (primitive.target !== target) return;

    if (primitive.kind === 'distortion') {
      const effectType = primitive.distortion === 'swirl' ? 'twirl' : 'bulge';
      const effectId = `transition-effect:${clipId}:${index}:${effectType}`;
      const start = clamp01(primitive.startProgress ?? 0) * duration;
      const end = clamp01(primitive.endProgress ?? 1) * duration;
      const mid = start + (Math.max(start, end) - start) * 0.5;
      const neutralAmount = primitive.distortion === 'swirl' ? 0 : 1;
      const peakAmount = primitive.distortion === 'swirl' ? 3 : 0.45;
      effects.push({
        id: effectId,
        name: primitive.distortion === 'swirl' ? 'Twirl' : 'Bulge/Pinch',
        type: effectType,
        enabled: true,
        params: {
          amount: neutralAmount,
          radius: primitive.distortion === 'swirl' ? 0.72 : 0.92,
          centerX: 0.5,
          centerY: 0.5,
        },
      });
      keyframes.push(
        makeKeyframe(clipId, `effect.${effectId}.amount` as Keyframe['property'], start, neutralAmount, primitive.curve ?? 'linear'),
        makeKeyframe(clipId, `effect.${effectId}.amount` as Keyframe['property'], mid, peakAmount, primitive.curve ?? 'ease-in-out'),
        makeKeyframe(clipId, `effect.${effectId}.amount` as Keyframe['property'], Math.max(start, end), neutralAmount, primitive.curve ?? 'linear'),
      );
      return;
    }

    const effectId = `transition-effect:${clipId}:${index}:${primitive.effectType}`;
    const params: Effect['params'] = {};
    for (const [paramId, value] of Object.entries(primitive.params)) {
      if (isTransitionNumberRange(value)) {
        params[paramId] = value.from;
        addRangeKeyframes(
          keyframes,
          clipId,
          `effect.${effectId}.${paramId}` as Keyframe['property'],
          duration,
          value,
          primitive,
          next => next,
        );
      } else {
        params[paramId] = value;
      }
    }

    effects.push({
      id: effectId,
      name: primitive.effectName ?? primitive.effectType,
      type: primitive.effectType as Effect['type'],
      enabled: true,
      params,
    });
  });
  return { effects, keyframes };
}

export function getBlendModeFromRecipe(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  startTime: number,
  duration: number,
  transitionDuration: number,
): SerializableClip['transform']['blendMode'] | undefined {
  const primitive = recipe.find((candidate) =>
    candidate.kind === 'blend' && candidate.target === target
  );
  if (primitive?.kind !== 'blend') return undefined;
  const activeStart = (primitive.startProgress ?? 0) * transitionDuration;
  const activeEnd = (primitive.endProgress ?? 1) * transitionDuration;
  const midpoint = startTime + duration * 0.5;
  if (midpoint < activeStart || midpoint >= activeEnd) return undefined;
  return primitive?.kind === 'blend'
    ? primitive.mode as SerializableClip['transform']['blendMode']
    : undefined;
}

export function getBlendBoundaries(recipe: readonly TransitionPrimitive[], target: 'outgoing' | 'incoming', duration: number): number[] {
  return recipe
    .filter((primitive): primitive is Extract<TransitionPrimitive, { kind: 'blend' }> =>
      primitive.kind === 'blend' && primitive.target === target
    )
    .flatMap((primitive) => [
      (primitive.startProgress ?? 0) * duration,
      (primitive.endProgress ?? 1) * duration,
    ])
    .filter((time) => time > 0.0001 && time < duration - 0.0001);
}

export type MultiPanelPrimitive = Extract<TransitionPrimitive, { kind: 'multi-panel' }>;

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function easeProgress(progress: number, curve: { curve?: string } | undefined): number {
  if (curve?.curve === 'ease-in') return progress * progress;
  if (curve?.curve === 'ease-out') return 1 - (1 - progress) * (1 - progress);
  if (curve?.curve === 'ease-in-out') {
    return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) * 0.5;
  }
  return progress;
}

export function evaluatePrimitiveProgress(
  primitive: { startProgress?: number; endProgress?: number; curve?: string },
  progress: number,
): number {
  const start = primitive.startProgress ?? 0;
  const end = primitive.endProgress ?? 1;
  if (progress <= start) return 0;
  if (progress >= end) return 1;
  return easeProgress(clamp01((progress - start) / Math.max(0.0001, end - start)), primitive);
}

export function getTransitionSeed(transition: TimelineTransition, primitive?: { seed?: number }): number {
  const paramSeed = transition.params?.seed;
  if (typeof paramSeed === 'number' && Number.isFinite(paramSeed)) return paramSeed;
  return Number.isFinite(primitive?.seed) ? primitive?.seed ?? 0 : 0;
}

export function getMultiPanelPrimitive(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
): MultiPanelPrimitive | undefined {
  return recipe.find((primitive): primitive is MultiPanelPrimitive =>
    primitive.kind === 'multi-panel' && primitive.target === target
  );
}

export function createClipBaseLayer(clip: SerializableClip): Layer {
  return {
    id: clip.id,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: clip.transform.opacity,
    blendMode: clip.transform.blendMode,
    source: null,
    effects: clip.effects ?? [],
    position: { ...clip.transform.position },
    scale: { x: clip.transform.scale.x, y: clip.transform.scale.y, z: clip.transform.scale.z },
    rotation: { ...clip.transform.rotation },
  };
}

export function composeSourceRect(
  base: SerializableClip['sourceRect'],
  panel: NonNullable<SerializableClip['sourceRect']>,
): NonNullable<SerializableClip['sourceRect']> {
  if (!base) return { ...panel };
  return {
    x: base.x + panel.x * base.width,
    y: base.y + panel.y * base.height,
    width: base.width * panel.width,
    height: base.height * panel.height,
  };
}

export function getLayerRotationZ(rotation: Layer['rotation']): number {
  return typeof rotation === 'number' ? rotation : rotation.z;
}

export function buildPanelKeyframes(
  panelClipId: string,
  duration: number,
  primitive: MultiPanelPrimitive,
  baseLayer: Layer,
  seed: number,
): Keyframe[] {
  const progressStops = [
    0,
    primitive.startProgress ?? 0,
    0.25,
    0.5,
    0.75,
    primitive.endProgress ?? 1,
    1,
  ].map(clamp01).toSorted((a, b) => a - b);
  const uniqueStops = progressStops.filter((stop, index) => index === 0 || Math.abs(stop - progressStops[index - 1]) > 0.0001);
  const keyframes: Keyframe[] = [];

  for (const progress of uniqueStops) {
    const state = createTransitionMultiPanelLayerStates({
      baseLayer,
      primitive,
      progress: evaluatePrimitiveProgress(primitive, progress),
      seed,
    }).find((candidate) => candidate.id === panelClipId);
    if (!state) continue;

    const time = progress * duration;
    keyframes.push(
      makeKeyframe(panelClipId, 'opacity', time, state.opacity, primitive.curve ?? 'linear'),
      makeKeyframe(panelClipId, 'position.x', time, state.position.x, primitive.curve ?? 'linear'),
      makeKeyframe(panelClipId, 'position.y', time, state.position.y, primitive.curve ?? 'linear'),
      makeKeyframe(panelClipId, 'position.z', time, state.position.z, primitive.curve ?? 'linear'),
      makeKeyframe(panelClipId, 'scale.x', time, state.scale.x, primitive.curve ?? 'linear'),
      makeKeyframe(panelClipId, 'scale.y', time, state.scale.y, primitive.curve ?? 'linear'),
      makeKeyframe(panelClipId, 'rotation.z', time, getLayerRotationZ(state.rotation), primitive.curve ?? 'linear'),
    );
  }

  return keyframes;
}

export function expandMultiPanelClips(
  clips: readonly SerializableClip[],
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  transition: TimelineTransition,
  duration: number,
): SerializableClip[] {
  const primitive = getMultiPanelPrimitive(recipe, target);
  if (!primitive) return [...clips];
  const seed = getTransitionSeed(transition, primitive);

  return clips.flatMap((clip) => {
    const baseLayer = createClipBaseLayer(clip);
    const finalStates = createTransitionMultiPanelLayerStates({
      baseLayer,
      primitive,
      progress: 1,
      seed,
    });

    return finalStates.map((state) => {
      const panelClip: SerializableClip = {
        ...clone(clip),
        id: state.id,
        name: state.name,
        trackId: `${clip.trackId}:${state.panel.id}`,
        sourceRect: composeSourceRect(clip.sourceRect, state.sourceRect!),
        transform: {
          ...clip.transform,
          opacity: state.opacity,
          position: { ...state.position },
          scale: {
            x: state.scale.x,
            y: state.scale.y,
            ...(state.scale.z !== undefined || clip.transform.scale.z !== undefined
              ? { z: state.scale.z ?? clip.transform.scale.z }
              : {}),
          },
          rotation: {
            ...clip.transform.rotation,
            z: getLayerRotationZ(state.rotation),
          },
        },
      };
      const panelKeyframes = buildPanelKeyframes(state.id, duration, primitive, baseLayer, seed);
      return {
        ...panelClip,
        keyframes: mergeGeneratedKeyframes(
          clip.keyframes,
          sliceGeneratedKeyframesForSegment(panelClip, panelKeyframes, clip.startTime, clip.duration),
        ),
      };
    });
  });
}

export function mergeTransitionMarkers(
  existingMarkers: readonly SerializableMarker[] | undefined,
  transitionId: string,
  bodyStart: number,
  bodyEnd: number,
): SerializableMarker[] {
  const startId = `transition-comp:${transitionId}:body-start`;
  const endId = `transition-comp:${transitionId}:body-end`;
  const userMarkers = (existingMarkers ?? []).filter((marker) => marker.id !== startId && marker.id !== endId);
  return [
    ...userMarkers,
    { id: startId, time: bodyStart, label: 'Transition In', color: '#4a9eff' },
    { id: endId, time: bodyEnd, label: 'Transition Out', color: '#ff6b4a' },
  ];
}

export function buildTransitionTimelineData(input: {
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  transition: TimelineTransition;
  plan: TransitionPlan;
  serializableClips: readonly SerializableClip[];
}): { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> } {
  const { outgoingClip, incomingClip, transition, plan, serializableClips } = input;
  const duration = Math.max(0.0001, transition.duration);
  const bodyStart = 0;
  const bodyEnd = duration;
  const outgoingTrackId = `transition-comp-track:${transition.id}:outgoing`;
  const incomingTrackId = `transition-comp-track:${transition.id}:incoming`;
  const solidTrackId = `transition-comp-track:${transition.id}:solid`;
  const outgoingClipId = `transition-comp:${transition.id}:outgoing`;
  const incomingClipId = `transition-comp:${transition.id}:incoming`;
  const solidClipId = `transition-comp:${transition.id}:solid`;
  const baseOutgoing = getSerializableClip(outgoingClip, serializableClips);
  const baseIncoming = getSerializableClip(incomingClip, serializableClips);
  const definition = getRuntimeTransition(transition.type);
  const solid = definition?.recipe.find((primitive) => primitive.kind === 'solid');
  const overlays = definition?.recipe.filter((primitive): primitive is Extract<TransitionPrimitive, { kind: 'overlay' }> =>
    primitive.kind === 'overlay'
  ) ?? [];
  const recipe = definition?.recipe ?? [];
  const materializeRecipeClip = (clip: SerializableClip, target: 'outgoing' | 'incoming'): SerializableClip => {
    const opacityKeyframes = buildOpacityKeyframesFromRecipe(recipe, target, clip.id, duration);
    const transformKeyframes = buildTransformKeyframesFromRecipe(recipe, target, clip, duration);
    const effects = buildEffectMaterializationFromRecipe(recipe, target, clip.id, duration);
    const masks = buildMaskMaterializationFromRecipe(recipe, target, clip.id, duration);
    const blendMode = getBlendModeFromRecipe(recipe, target, clip.startTime, clip.duration, duration);
    const clipWithGeneratedProperties: SerializableClip = {
      ...clip,
      transform: {
        ...clip.transform,
        blendMode: blendMode ?? clip.transform.blendMode,
      },
      effects: [...(clip.effects ?? []), ...effects.effects],
      masks: [...(clip.masks ?? []), ...masks.masks],
    };
    const generatedKeyframes = [
      ...opacityKeyframes,
      ...transformKeyframes,
      ...effects.keyframes,
      ...masks.keyframes,
    ];
    return {
      ...clipWithGeneratedProperties,
      keyframes: mergeGeneratedKeyframes(
        clip.keyframes,
        sliceGeneratedKeyframesForSegment(
          clipWithGeneratedProperties,
          generatedKeyframes,
          clip.startTime,
          clip.duration,
        ),
      ),
    };
  };
  const outgoingLinkedClips = expandMultiPanelClips(buildLinkedCoverageClips({
    base: baseOutgoing,
    baseId: outgoingClipId,
    trackId: outgoingTrackId,
    nameSuffix: '[OUT linked]',
    participant: plan.outgoing,
    bodyStart: plan.bodyStart,
    duration,
    splitBoundaries: getBlendBoundaries(recipe, 'outgoing', duration),
    materialize: (clip) => materializeRecipeClip(clip, 'outgoing'),
  }), recipe, 'outgoing', transition, duration);
  const incomingLinkedClips = expandMultiPanelClips(buildLinkedCoverageClips({
    base: baseIncoming,
    baseId: incomingClipId,
    trackId: incomingTrackId,
    nameSuffix: '[IN linked]',
    participant: plan.incoming,
    bodyStart: plan.bodyStart,
    duration,
    splitBoundaries: getBlendBoundaries(recipe, 'incoming', duration),
    materialize: (clip) => materializeRecipeClip(clip, 'incoming'),
  }), recipe, 'incoming', transition, duration);
  const clips: SerializableClip[] = [
    ...outgoingLinkedClips,
    ...incomingLinkedClips,
  ];
  const panelTracks = clips
    .filter((clip) => clip.sourceRect)
    .filter((clip, index, panelClips) => panelClips.findIndex((candidate) => candidate.trackId === clip.trackId) === index)
    .map((clip) => ({
      id: clip.trackId,
      name: clip.name,
      type: 'video' as const,
      height: 56,
      muted: false,
      visible: true,
      solo: false,
    }));

  if (solid) {
    clips.push({
      id: solidClipId,
      trackId: solidTrackId,
      name: 'Transition Solid',
      mediaFileId: '',
      startTime: 0,
      duration,
      inPoint: 0,
      outPoint: duration,
      sourceType: 'solid',
      naturalDuration: duration,
      solidColor: resolveTransitionColor(transition, solid.color, solid.colorParam),
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
      keyframes: buildOpacityKeyframesFromRecipe(definition?.recipe ?? [], 'solid', solidClipId, duration),
    });
  }

  const overlayTracks = overlays.map((_, index) => ({
    id: `transition-comp-track:${transition.id}:overlay:${index}`,
    name: 'Overlay',
    type: 'video' as const,
    height: 72,
    muted: false,
    visible: true,
    solo: false,
  }));
  clips.push(...overlays.map((overlay, index): SerializableClip => {
    const clipId = `transition-comp:${transition.id}:overlay:${index}`;
    const overlayDefinition: TransitionOverlayClipDefinition = {
      pattern: overlay.overlay,
      color: resolveTransitionColor(transition, overlay.color, overlay.colorParam),
      widthRatio: overlay.width ?? 0.32,
      softness: overlay.softness ?? 0.42,
      angle: overlay.angle ?? 0,
    };
    return {
      id: clipId,
      trackId: overlayTracks[index].id,
      name: 'Transition Overlay',
      mediaFileId: '',
      startTime: 0,
      duration,
      inPoint: 0,
      outPoint: duration,
      sourceType: 'transition-overlay',
      naturalDuration: duration,
      transitionOverlay: overlayDefinition,
      transform: {
        opacity: overlay.opacity?.from ?? 1,
        blendMode: (overlay.blendMode ?? 'screen') as SerializableClip['transform']['blendMode'],
        position: { x: overlay.centerX?.from ?? 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
      keyframes: [
        ...(overlay.opacity ? [
          makeKeyframe(clipId, 'opacity', (overlay.startProgress ?? 0) * duration, overlay.opacity.from, overlay.curve ?? 'linear'),
          makeKeyframe(clipId, 'opacity', (overlay.endProgress ?? 1) * duration, overlay.opacity.to, overlay.curve ?? 'linear'),
        ] : []),
        ...(overlay.centerX ? [
          makeKeyframe(clipId, 'position.x', (overlay.startProgress ?? 0) * duration, overlay.centerX.from, overlay.curve ?? 'linear'),
          makeKeyframe(clipId, 'position.x', (overlay.endProgress ?? 1) * duration, overlay.centerX.to, overlay.curve ?? 'linear'),
        ] : []),
      ],
    };
  }));

  return {
    link: {
      kind: 'transition-comp',
      parentTransitionId: transition.id,
      parentOutgoingClipId: outgoingClip.id,
      parentIncomingClipId: incomingClip.id,
      linkedOutgoingClipId: outgoingClipId,
      linkedIncomingClipId: incomingClipId,
      innerTransitionId: '',
      templateType: transition.type,
      templateVersion: TRANSITION_TEMPLATE_VERSION,
      templateParamsKey: getTransitionTemplateParamsKey(transition, outgoingClip, incomingClip),
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart,
      bodyEnd,
      materialized: true,
    },
    timelineData: {
      tracks: [
        ...overlayTracks,
        ...(solid ? [{ id: solidTrackId, name: 'Solid', type: 'video' as const, height: 72, muted: false, visible: true, solo: false }] : []),
        ...panelTracks,
        ...(incomingLinkedClips.some((clip) => clip.trackId === incomingTrackId)
          ? [{ id: incomingTrackId, name: 'Incoming', type: 'video' as const, height: 96, muted: false, visible: true, solo: false }]
          : []),
        ...(outgoingLinkedClips.some((clip) => clip.trackId === outgoingTrackId)
          ? [{ id: outgoingTrackId, name: 'Outgoing', type: 'video' as const, height: 96, muted: false, visible: true, solo: false }]
          : []),
      ],
      clips,
      playheadPosition: bodyStart,
      duration,
      durationLocked: true,
      zoom: 160,
      scrollX: 0,
      inPoint: bodyStart,
      outPoint: bodyEnd,
      loopPlayback: true,
      markers: mergeTransitionMarkers(undefined, transition.id, bodyStart, bodyEnd),
    },
  };
}

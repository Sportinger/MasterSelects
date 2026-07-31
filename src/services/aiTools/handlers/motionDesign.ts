import {
  createColorFillAppearance,
  createDefaultReplicatorDefinition,
  createLinearGradientAppearance,
  createMotionAppearanceId,
  createRadialGradientAppearance,
  createStrokeAppearance,
  MOTION_APPEARANCE_BLEND_MODES,
  type AppearanceItem,
  type ColorFillAppearance,
  type GradientStop,
  type MotionColor,
  type MotionLayerDefinition,
  type MotionVector2,
  type StrokeAppearance,
} from '../../../types/motionDesign';
import {
  MOTION_MAX_APPEARANCES,
  MOTION_MAX_GRADIENT_STOPS,
} from '../../../engine/motion/MotionBuffers';
import type { TimelineClip } from '../../../types/timeline';
import type { PropertyDescriptor } from '../../../types/propertyRegistry';
import { useTimelineStore } from '../../../stores/timeline';
import {
  MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS,
  MOTION_DESIGN_MVP_PRIMITIVES,
  applyValidatedMotionPropertyUpdates,
  describeMotionDesignClip,
  getMotionMvpCapabilities,
  isMotionShapeClip,
  parseMotionColor,
  validateFiniteNumber,
  type MotionPropertyUpdateInput,
} from '../../motionDesign/mvpCapabilities';
import { propertyRegistry } from '../../properties';
import {
  describePropertyAuthoringDescriptor,
  writePropertyAuthoringValue,
} from '../../properties/propertyAuthoring';
import { selectClipAndOpenTab } from '../aiFeedback';
import type { ToolResult } from '../types';
import { resolveClipPositionAuthoringContext } from './keyframePositionUnits';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

interface FillPatch {
  enabled?: boolean;
  color?: MotionColor;
  opacity?: number;
}

interface StrokePatch extends FillPatch {
  width?: number;
  alignment?: StrokeAppearance['alignment'];
}

interface AppearanceOperationResult {
  motion: MotionLayerDefinition;
  createdAppearanceIds: string[];
  createdGradientStopIds: string[];
}

export async function handleGetMotionCapabilities(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = optionalNonEmptyString(args.clipId, 'clipId');
  if (clipId instanceof Error) return failure(clipId.message);
  if (!clipId) {
    return { success: true, data: describeMotionCapabilitiesForAi() };
  }

  const clipResult = findMotionShapeClip(clipId, timelineStore, true);
  if (!clipResult.success) return clipResult.result;
  return {
    success: true,
    data: describeMotionCapabilitiesForAi(clipResult.clip),
  };
}

export async function handleGetMotionDesign(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore, true);
  if (!clipResult.success) return clipResult.result;
  return {
    success: true,
    data: describeMotionDesignForAi(clipResult.clip),
  };
}

export async function handleCreateMotionShapeClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  try {
    const trackResult = resolveVideoTrack(args.trackId, timelineStore);
    if (!trackResult.success) return trackResult.result;
    const startTime = args.startTime === undefined
      ? timelineStore.playheadPosition
      : validateFiniteNumber(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
    const duration = args.duration === undefined
      ? 5
      : validateFiniteNumber(args.duration, 'duration', Number.EPSILON, Number.MAX_SAFE_INTEGER);
    const primitive = args.primitive === undefined ? 'rectangle' : args.primitive;
    if (
      typeof primitive !== 'string'
      || !MOTION_DESIGN_MVP_PRIMITIVES.includes(
        primitive as (typeof MOTION_DESIGN_MVP_PRIMITIVES)[number],
      )
    ) {
      return failure(`primitive must be one of: ${MOTION_DESIGN_MVP_PRIMITIVES.join(', ')}`);
    }
    const validatedPrimitive =
      primitive as (typeof MOTION_DESIGN_MVP_PRIMITIVES)[number];

    const width = args.width === undefined
      ? 320
      : validateFiniteNumber(args.width, 'width', 1, 100000);
    const height = args.height === undefined
      ? 180
      : validateFiniteNumber(args.height, 'height', 1, 100000);
    const cornerRadius = args.cornerRadius === undefined
      ? undefined
      : validateFiniteNumber(args.cornerRadius, 'cornerRadius', 0, 100000);
    const points = args.points === undefined
      ? undefined
      : validateInteger(args.points, 'points', 3, 32);
    const radius = args.radius === undefined
      ? undefined
      : validateFiniteNumber(args.radius, 'radius', 1, 100000);
    const outerRadius = args.outerRadius === undefined
      ? undefined
      : validateFiniteNumber(args.outerRadius, 'outerRadius', 1, 100000);
    const innerRadius = args.innerRadius === undefined
      ? undefined
      : validateFiniteNumber(args.innerRadius, 'innerRadius', 0.5, 100000);
    if (cornerRadius !== undefined && validatedPrimitive === 'ellipse') {
      return failure('cornerRadius is not supported for ellipse motion shapes');
    }
    if ((points !== undefined || radius !== undefined) && validatedPrimitive !== 'polygon') {
      if (validatedPrimitive !== 'star' || radius !== undefined) {
        return failure('points/radius are only supported for polygon; star accepts points, outerRadius, and innerRadius');
      }
    }
    if (
      (outerRadius !== undefined || innerRadius !== undefined)
      && validatedPrimitive !== 'star'
    ) {
      return failure('outerRadius and innerRadius are only supported for star motion shapes');
    }
    if (
      validatedPrimitive === 'star'
      && innerRadius !== undefined
      && innerRadius > (outerRadius ?? Math.min(width, height) * 0.5)
    ) {
      return failure('innerRadius must not exceed the star outerRadius');
    }

    const name = optionalNonEmptyString(args.name, 'name');
    if (name instanceof Error) return failure(name.message);
    const fill = normalizeFillPatch(args.fill);
    const stroke = normalizeStrokePatch(args.stroke);
    const mutationSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);
    const clipId = useTimelineStore.getState().addMotionShapeClip(
      trackResult.track.id,
      startTime,
      {
        primitive: validatedPrimitive,
        size: { w: width, h: height },
        duration,
        ...(name ? { name } : {}),
        ...(fill?.color ? { fillColor: fill.color } : {}),
      },
    );
    if (!clipId) {
      return failure('The editor could not create the motion shape clip');
    }

    if (
      cornerRadius !== undefined
      || points !== undefined
      || radius !== undefined
      || outerRadius !== undefined
      || innerRadius !== undefined
      || fill
      || stroke
    ) {
      useTimelineStore.getState().updateMotionLayer(clipId, (motion) => {
        let nextMotion = motion;
        if (
          (
            cornerRadius !== undefined
            || points !== undefined
            || radius !== undefined
            || outerRadius !== undefined
            || innerRadius !== undefined
          )
          && nextMotion.shape
        ) {
          const shape = nextMotion.shape;
          const defaultRadius = Math.min(shape.size.w, shape.size.h) * 0.5;
          nextMotion = {
            ...nextMotion,
            shape: {
              ...shape,
              ...(validatedPrimitive === 'rectangle'
                ? { cornerRadius: cornerRadius ?? shape.cornerRadius ?? 0 }
                : {}),
              ...(validatedPrimitive === 'polygon'
                ? {
                    polygon: {
                      points: points ?? shape.polygon?.points ?? 6,
                      radius: radius ?? shape.polygon?.radius ?? defaultRadius,
                      cornerRadius:
                        cornerRadius ?? shape.polygon?.cornerRadius ?? 0,
                    },
                  }
                : {}),
              ...(validatedPrimitive === 'star'
                ? {
                    star: {
                      points: points ?? shape.star?.points ?? 5,
                      outerRadius:
                        outerRadius ?? shape.star?.outerRadius ?? defaultRadius,
                      innerRadius:
                        innerRadius ?? shape.star?.innerRadius ?? defaultRadius * 0.5,
                      cornerRadius:
                        cornerRadius ?? shape.star?.cornerRadius ?? 0,
                    },
                  }
                : {}),
            },
          };
        }
        return applyAppearancePatches(nextMotion, fill, stroke);
      });
    }

    const finalClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
    if (!finalClip || !isMotionShapeClip(finalClip)) {
      return failure(`Created motion shape could not be resolved: ${clipId}`);
    }
    selectClipAndOpenTab(clipId, 'motion');
    return {
      success: true,
      data: {
        ...describeMotionDesignForAi(finalClip),
        ...describeMutationEntities(
          mutationSnapshot,
          useTimelineStore.getState().clips,
        ),
      },
    };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export async function handleUpdateMotionProperties(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore);
  if (!clipResult.success) return clipResult.result;
  if (!Array.isArray(args.updates) || args.updates.length === 0) {
    return failure('updates must be a non-empty array');
  }
  if (args.updates.length > 50) {
    return failure('updates may contain at most 50 properties');
  }

  try {
    const updates = args.updates.map((value): MotionPropertyUpdateInput => {
      if (!isRecord(value)) {
        throw new Error('Each motion property update must be an object');
      }
      return {
        path: value.path as string,
        value: value.value,
      };
    });
    const seenPaths = new Set<string>();
    const supportedMotionPaths = new Set(
      describeMotionDesignClip(clipResult.clip).properties.map((property) => property.path),
    );
    const motionUpdates: MotionPropertyUpdateInput[] = [];
    const transformUpdates: Array<MotionPropertyUpdateInput & { descriptor: PropertyDescriptor }> = [];
    for (const update of updates) {
      if (typeof update.path !== 'string' || !update.path.trim()) {
        throw new Error('Each motion property update requires a non-empty path');
      }
      if (seenPaths.has(update.path)) {
        throw new Error(`Duplicate motion property update: ${update.path}`);
      }
      seenPaths.add(update.path);
      const descriptor = getExactClipPropertyDescriptor(clipResult.clip, update.path);
      if (!descriptor.write) {
        throw new Error(`Property is not writable: ${update.path}`);
      }
      if (descriptor.group === 'Transform') {
        transformUpdates.push({ ...update, descriptor });
      } else if (supportedMotionPaths.has(update.path)) {
        motionUpdates.push(update);
      } else {
        throw new Error(
          `Motion property is not supported by the current renderer: ${update.path}`,
        );
      }
    }

    let updatedClip = motionUpdates.length > 0
      ? applyValidatedMotionPropertyUpdates(clipResult.clip, motionUpdates)
      : clipResult.clip;
    const needsPositionContext = transformUpdates.some(
      ({ descriptor }) => descriptor.authoring?.codec === 'transform-position',
    );
    const authoringContext = needsPositionContext
      ? resolveClipPositionAuthoringContext(clipResult.clip)
      : undefined;
    for (const update of transformUpdates) {
      updatedClip = writePropertyAuthoringValue(
        propertyRegistry,
        updatedClip,
        update.path,
        update.value,
        authoringContext,
      );
    }

    const mutationSnapshot = captureMutationEntitySnapshot('clip', [clipResult.clip]);
    const liveTimeline = useTimelineStore.getState();
    liveTimeline.updateClip(clipResult.clip.id, {
      transform: structuredClone(updatedClip.transform),
      motion: structuredClone(updatedClip.motion!),
      speed: updatedClip.speed,
    });
    liveTimeline.invalidateCache();

    const finalClip = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipResult.clip.id,
    );
    if (!finalClip || !isMotionShapeClip(finalClip)) {
      return failure(`Motion shape disappeared: ${clipResult.clip.id}`);
    }
    selectClipAndOpenTab(finalClip.id, 'motion');
    return {
      success: true,
      data: {
        ...describeMotionDesignForAi(finalClip),
        updatedProperties: updates.map((update) => update.path),
        ...describeMutationEntities(
          mutationSnapshot,
          [finalClip],
          { updatedEntityIds: [finalClip.id] },
        ),
      },
    };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export async function handleUpdateMotionAppearances(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore);
  if (!clipResult.success) return clipResult.result;

  try {
    const fill = normalizeFillPatch(args.fill);
    const stroke = normalizeStrokePatch(args.stroke);
    const operations = args.operations;
    if (
      operations !== undefined
      && (!Array.isArray(operations) || operations.length === 0)
    ) {
      return failure('operations must be a non-empty array when supplied');
    }
    if (!fill && !stroke && operations === undefined) {
      return failure('Provide fill, stroke, and/or structured appearance operations');
    }

    let operationResult: AppearanceOperationResult = {
      motion: structuredClone(clipResult.clip.motion!),
      createdAppearanceIds: [],
      createdGradientStopIds: [],
    };
    if (Array.isArray(operations)) {
      operationResult = applyAppearanceOperations(
        operationResult.motion,
        operations,
      );
    }
    operationResult.motion = applyAppearancePatches(
      operationResult.motion,
      fill,
      stroke,
    );
    validateAppearanceStack(operationResult.motion);

    const mutationSnapshot = captureMutationEntitySnapshot('clip', [clipResult.clip]);
    useTimelineStore.getState().updateMotionLayer(
      clipResult.clip.id,
      () => operationResult.motion,
    );

    const finalClip = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipResult.clip.id,
    );
    if (!finalClip || !isMotionShapeClip(finalClip)) {
      return failure(`Motion shape disappeared: ${clipResult.clip.id}`);
    }
    selectClipAndOpenTab(finalClip.id, 'motion');
    return {
      success: true,
      data: {
        ...describeMotionDesignForAi(finalClip),
        createdAppearanceIds: operationResult.createdAppearanceIds,
        createdGradientStopIds: operationResult.createdGradientStopIds,
        ...describeMutationEntities(
          mutationSnapshot,
          [finalClip],
          { updatedEntityIds: [finalClip.id] },
        ),
      },
    };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export async function handleConfigureMotionReplicator(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore);
  if (!clipResult.success) return clipResult.result;

  const suppliedKeys = ['enabled', 'countX', 'countY', 'spacingX', 'spacingY', 'fade']
    .filter((key) => args[key] !== undefined);
  if (suppliedKeys.length === 0) {
    return failure('Provide at least one Grid Replicator setting');
  }

  try {
    const enabled = optionalBoolean(args.enabled, 'enabled');
    const countX = optionalInteger(
      args.countX,
      'countX',
      1,
      MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS,
    );
    const countY = optionalInteger(
      args.countY,
      'countY',
      1,
      MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS,
    );
    const spacingX = optionalFiniteNumber(args.spacingX, 'spacingX', -100000, 100000);
    const spacingY = optionalFiniteNumber(args.spacingY, 'spacingY', -100000, 100000);
    const fade = optionalFiniteNumber(args.fade, 'fade', 0, 1);
    const currentReplicator = clipResult.clip.motion?.replicator
      ?? createDefaultReplicatorDefinition();
    const currentGrid = currentReplicator.layout.mode === 'grid'
      ? currentReplicator.layout
      : createDefaultReplicatorDefinition().layout;
    if (currentGrid.mode !== 'grid') {
      return failure('Only the Grid Replicator is supported in Motion Design MD0');
    }
    const nextCountX = countX ?? currentGrid.count.x;
    const nextCountY = countY ?? currentGrid.count.y;
    if (nextCountX * nextCountY > 100) {
      return failure('The current Grid Replicator supports at most 100 instances');
    }

    const mutationSnapshot = captureMutationEntitySnapshot('clip', [clipResult.clip]);
    useTimelineStore.getState().updateMotionLayer(clipResult.clip.id, (motion) => ({
      ...motion,
      replicator: {
        ...currentReplicator,
        enabled: enabled ?? currentReplicator.enabled,
        layout: {
          ...currentGrid,
          count: { x: nextCountX, y: nextCountY },
          spacing: {
            x: spacingX ?? currentGrid.spacing.x,
            y: spacingY ?? currentGrid.spacing.y,
          },
        },
        offset: {
          ...currentReplicator.offset,
          opacity: fade ?? currentReplicator.offset.opacity,
        },
      },
    }));

    const finalClip = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipResult.clip.id,
    );
    if (!finalClip || !isMotionShapeClip(finalClip)) {
      return failure(`Motion shape disappeared: ${clipResult.clip.id}`);
    }
    selectClipAndOpenTab(finalClip.id, 'motion');
    return {
      success: true,
      data: {
        ...describeMotionDesignForAi(finalClip),
        configuredProperties: suppliedKeys,
        ...describeMutationEntities(
          mutationSnapshot,
          [finalClip],
          { updatedEntityIds: [finalClip.id] },
        ),
      },
    };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

function describeMotionCapabilitiesForAi(clip?: TimelineClip) {
  const capabilities = getMotionMvpCapabilities(clip);
  if (!clip) {
    return {
      ...capabilities,
      transformProperties: propertyRegistry
        .getAllDescriptors()
        .filter((descriptor) => descriptor.group === 'Transform')
        .map((descriptor) => ({
          path: descriptor.path,
          label: descriptor.label,
          group: descriptor.group,
          valueType: descriptor.valueType,
          animatable: descriptor.animatable,
          writable: descriptor.write !== undefined,
          aliases: [...(descriptor.ui?.aliases ?? [])],
        })),
    };
  }
  return {
    ...capabilities,
    properties: getMotionAndTransformPropertyViews(clip),
  };
}

function describeMotionDesignForAi(clip: TimelineClip) {
  return {
    ...describeMotionDesignClip(clip),
    properties: getMotionAndTransformPropertyViews(clip),
  };
}

function getMotionAndTransformPropertyViews(clip: TimelineClip) {
  const motionProperties = describeMotionDesignClip(clip).properties;
  const needsPositionContext = propertyRegistry
    .getAllDescriptors(clip)
    .some((descriptor) => (
      descriptor.group === 'Transform'
      && descriptor.authoring?.codec === 'transform-position'
    ));
  let positionContext: ReturnType<typeof resolveClipPositionAuthoringContext> | undefined;
  let positionContextError: string | undefined;
  if (needsPositionContext) {
    try {
      positionContext = resolveClipPositionAuthoringContext(clip);
    } catch (error) {
      positionContextError = errorMessage(error);
    }
  }
  const transformProperties = propertyRegistry
    .getAllDescriptors(clip)
    .filter((descriptor) => descriptor.group === 'Transform')
    .map((descriptor) => {
      if (
        descriptor.authoring?.codec === 'transform-position'
        && !positionContext
      ) {
        return {
          path: descriptor.path,
          label: descriptor.label,
          group: descriptor.group,
          valueType: descriptor.valueType,
          animatable: descriptor.animatable,
          writable: descriptor.write !== undefined,
          aliases: [...(descriptor.ui?.aliases ?? [])],
          authoringContextRequired: true,
          authoringContextError: positionContextError,
        };
      }
      return describePropertyAuthoringDescriptor(descriptor, {
        clip,
        context: descriptor.authoring?.codec === 'transform-position'
          ? positionContext
          : undefined,
      });
    });
  const transformPaths = new Set(transformProperties.map((property) => property.path));
  return [
    ...transformProperties,
    ...motionProperties.filter((property) => !transformPaths.has(property.path)),
  ];
}

function getExactClipPropertyDescriptor(
  clip: TimelineClip,
  path: string,
): PropertyDescriptor {
  const descriptor = propertyRegistry
    .getAllDescriptors(clip)
    .find((candidate) => candidate.path === path);
  if (!descriptor) {
    throw new Error(`Property not found for clip: ${path}`);
  }
  return descriptor;
}

function findMotionShapeClip(
  clipIdInput: unknown,
  timelineStore: TimelineStore,
  allowLocked = false,
):
  | { success: true; clip: TimelineClip }
  | { success: false; result: ToolResult } {
  const clipId = requiredNonEmptyString(clipIdInput, 'clipId');
  if (clipId instanceof Error) {
    return { success: false, result: failure(clipId.message) };
  }
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return { success: false, result: failure(`Clip not found: ${clipId}`) };
  }
  if (!isMotionShapeClip(clip)) {
    return {
      success: false,
      result: failure(`Clip is not a rendered motion shape: ${clipId}`),
    };
  }
  const track = timelineStore.tracks.find((candidate) => candidate.id === clip.trackId);
  if (!allowLocked && track?.locked) {
    return { success: false, result: failure(`Track is locked: ${track.id}`) };
  }
  return { success: true, clip };
}

function resolveVideoTrack(
  trackIdInput: unknown,
  timelineStore: TimelineStore,
):
  | { success: true; track: TimelineStore['tracks'][number] }
  | { success: false; result: ToolResult } {
  const trackId = optionalNonEmptyString(trackIdInput, 'trackId');
  if (trackId instanceof Error) {
    return { success: false, result: failure(trackId.message) };
  }
  const track = trackId
    ? timelineStore.tracks.find((candidate) => candidate.id === trackId)
    : timelineStore.tracks.find((candidate) => (
        candidate.type === 'video'
        && candidate.locked !== true
        && candidate.visible !== false
      ))
      ?? timelineStore.tracks.find((candidate) => (
        candidate.type === 'video' && candidate.locked !== true
      ));
  if (!track) {
    return {
      success: false,
      result: failure(trackId
        ? `Track not found: ${trackId}`
        : 'No unlocked video track is available for a motion shape'),
    };
  }
  if (track.type !== 'video') {
    return {
      success: false,
      result: failure(`Motion shapes require a video track: ${track.id}`),
    };
  }
  if (track.locked) {
    return { success: false, result: failure(`Track is locked: ${track.id}`) };
  }
  return { success: true, track };
}

function normalizeFillPatch(value: unknown): FillPatch | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('fill must be an object');
  const enabled = optionalBoolean(value.enabled, 'fill.enabled');
  const opacity = optionalFiniteNumber(value.opacity, 'fill.opacity', 0, 1);
  const color = value.color === undefined
    ? undefined
    : parseMotionColor(value.color, 'fill.color');
  if (enabled === undefined && opacity === undefined && color === undefined) {
    throw new Error('fill must contain at least one change');
  }
  return { enabled, opacity, color };
}

function normalizeStrokePatch(value: unknown): StrokePatch | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('stroke must be an object');
  const enabled = optionalBoolean(value.enabled, 'stroke.enabled');
  const opacity = optionalFiniteNumber(value.opacity, 'stroke.opacity', 0, 1);
  const width = optionalFiniteNumber(value.width, 'stroke.width', 0, 10000);
  const color = value.color === undefined
    ? undefined
    : parseMotionColor(value.color, 'stroke.color');
  const alignment = value.alignment === undefined ? undefined : value.alignment;
  if (
    alignment !== undefined
    && alignment !== 'center'
    && alignment !== 'inside'
    && alignment !== 'outside'
  ) {
    throw new Error('stroke.alignment must be one of: center, inside, outside');
  }
  if (
    enabled === undefined
    && opacity === undefined
    && width === undefined
    && color === undefined
    && alignment === undefined
  ) {
    throw new Error('stroke must contain at least one change');
  }
  return { enabled, opacity, width, color, alignment };
}

function applyAppearancePatches(
  motion: MotionLayerDefinition,
  fill: FillPatch | undefined,
  stroke: StrokePatch | undefined,
): MotionLayerDefinition {
  const appearance = motion.appearance ?? { version: 1 as const, items: [] };
  const items = appearance.items.map((item) => structuredClone(item));

  if (fill) {
    const existingIndex = items.findIndex((item) => item.kind === 'color-fill');
    const existing = existingIndex >= 0
      ? items[existingIndex] as ColorFillAppearance
      : createColorFillAppearance();
    const nextFill: ColorFillAppearance = {
      ...existing,
      visible: fill.enabled ?? existing.visible,
      opacity: fill.opacity ?? existing.opacity,
      color: fill.color ?? existing.color,
    };
    if (existingIndex >= 0) items[existingIndex] = nextFill;
    else items.push(nextFill);
  }

  if (stroke) {
    const existingIndex = items.findIndex((item) => item.kind === 'stroke');
    const existing = existingIndex >= 0
      ? items[existingIndex] as StrokeAppearance
      : createStrokeAppearance();
    const nextStroke: StrokeAppearance = {
      ...existing,
      visible: stroke.enabled ?? (existingIndex >= 0 ? existing.visible : true),
      opacity: stroke.opacity ?? existing.opacity,
      color: stroke.color ?? existing.color,
      width: stroke.width ?? existing.width,
      alignment: stroke.alignment ?? existing.alignment,
    };
    if (existingIndex >= 0) items[existingIndex] = nextStroke;
    else items.push(nextStroke);
  }

  return {
    ...motion,
    appearance: {
      ...appearance,
      items,
      selectedItemId: appearance.selectedItemId ?? items[0]?.id,
    },
  };
}

function applyAppearanceOperations(
  motion: MotionLayerDefinition,
  operationInputs: readonly unknown[],
): AppearanceOperationResult {
  if (operationInputs.length > 50) {
    throw new Error('operations may contain at most 50 appearance operations');
  }

  const appearance = motion.appearance ?? { version: 1 as const, items: [] };
  const items = appearance.items.map((item) => structuredClone(item));
  let selectedItemId = appearance.selectedItemId;
  const createdAppearanceIds: string[] = [];
  const createdGradientStopIds: string[] = [];

  operationInputs.forEach((input, operationIndex) => {
    if (!isRecord(input)) {
      throw new Error(`operations[${operationIndex}] must be an object`);
    }
    const operation = requiredNonEmptyString(
      input.operation,
      `operations[${operationIndex}].operation`,
    );
    if (operation instanceof Error) throw operation;

    if (operation === 'add') {
      const created = createAppearanceFromOperation(
        input,
        `operations[${operationIndex}]`,
      );
      const insertIndex = normalizeInsertIndex(
        input.index,
        items.length,
        `operations[${operationIndex}].index`,
      );
      items.splice(insertIndex, 0, created.item);
      selectedItemId = created.item.id;
      createdAppearanceIds.push(created.item.id);
      createdGradientStopIds.push(...created.createdGradientStopIds);
      return;
    }

    const itemId = requiredNonEmptyString(
      input.itemId,
      `operations[${operationIndex}].itemId`,
    );
    if (itemId instanceof Error) throw itemId;
    const itemIndex = items.findIndex((item) => item.id === itemId);
    if (itemIndex < 0) {
      throw new Error(`Appearance item not found: ${itemId}`);
    }

    if (operation === 'remove') {
      items.splice(itemIndex, 1);
      if (selectedItemId === itemId) {
        selectedItemId = items[Math.min(itemIndex, items.length - 1)]?.id;
      }
      return;
    }

    if (operation === 'move') {
      const targetIndex = normalizeInsertIndex(
        input.index,
        Math.max(0, items.length - 1),
        `operations[${operationIndex}].index`,
      );
      const [moved] = items.splice(itemIndex, 1);
      items.splice(targetIndex, 0, moved);
      return;
    }

    if (operation === 'duplicate') {
      const duplicate = structuredClone(items[itemIndex]);
      duplicate.id = createMotionAppearanceId(duplicate.kind);
      duplicate.name = `${duplicate.name} Copy`;
      if (duplicate.kind === 'linear-gradient' || duplicate.kind === 'radial-gradient') {
        duplicate.stops = duplicate.stops.map((stop) => ({
          ...stop,
          id: createMotionAppearanceId('stop'),
        }));
        createdGradientStopIds.push(...duplicate.stops.map((stop) => stop.id));
      }
      const targetIndex = input.index === undefined
        ? itemIndex + 1
        : normalizeInsertIndex(
            input.index,
            items.length,
            `operations[${operationIndex}].index`,
          );
      items.splice(targetIndex, 0, duplicate);
      selectedItemId = duplicate.id;
      createdAppearanceIds.push(duplicate.id);
      return;
    }

    if (
      operation === 'set-visibility'
      || operation === 'show'
      || operation === 'hide'
    ) {
      const visible = operation === 'show'
        ? true
        : operation === 'hide'
          ? false
          : optionalBoolean(
              input.visible,
              `operations[${operationIndex}].visible`,
            );
      if (visible === undefined) {
        throw new Error(`operations[${operationIndex}].visible is required`);
      }
      items[itemIndex] = { ...items[itemIndex], visible };
      return;
    }

    if (operation === 'update') {
      const updated = updateAppearanceFromOperation(
        items[itemIndex],
        input,
        `operations[${operationIndex}]`,
      );
      items[itemIndex] = updated.item;
      createdGradientStopIds.push(...updated.createdGradientStopIds);
      selectedItemId = updated.item.id;
      return;
    }

    throw new Error(
      `operations[${operationIndex}].operation must be one of: add, update, remove, move, duplicate, set-visibility, show, hide`,
    );
  });

  const nextMotion: MotionLayerDefinition = {
    ...motion,
    appearance: {
      ...appearance,
      items,
      ...(selectedItemId ? { selectedItemId } : { selectedItemId: undefined }),
    },
  };
  validateAppearanceStack(nextMotion);
  return {
    motion: nextMotion,
    createdAppearanceIds,
    createdGradientStopIds,
  };
}

function createAppearanceFromOperation(
  input: Record<string, unknown>,
  fieldName: string,
): { item: AppearanceItem; createdGradientStopIds: string[] } {
  const kind = requiredNonEmptyString(input.kind, `${fieldName}.kind`);
  if (kind instanceof Error) throw kind;
  let item: AppearanceItem;
  if (kind === 'color-fill') {
    item = createColorFillAppearance();
  } else if (kind === 'stroke') {
    item = { ...createStrokeAppearance(), visible: true };
  } else if (kind === 'linear-gradient') {
    item = createLinearGradientAppearance();
  } else if (kind === 'radial-gradient') {
    item = createRadialGradientAppearance();
  } else {
    throw new Error(
      `${fieldName}.kind must be one of: color-fill, stroke, linear-gradient, radial-gradient`,
    );
  }
  const updated = updateAppearanceFromOperation(item, input, fieldName);
  if (
    input.stops === undefined
    && (
      updated.item.kind === 'linear-gradient'
      || updated.item.kind === 'radial-gradient'
    )
  ) {
    return {
      item: updated.item,
      createdGradientStopIds: updated.item.stops.map((stop) => stop.id),
    };
  }
  return updated;
}

function updateAppearanceFromOperation(
  item: AppearanceItem,
  input: Record<string, unknown>,
  fieldName: string,
): { item: AppearanceItem; createdGradientStopIds: string[] } {
  const name = optionalNonEmptyString(input.name, `${fieldName}.name`);
  if (name instanceof Error) throw name;
  const visible = optionalBoolean(input.visible, `${fieldName}.visible`);
  const opacity = optionalFiniteNumber(
    input.opacity,
    `${fieldName}.opacity`,
    0,
    1,
  );
  const blendMode = normalizeBlendMode(input.blendMode, `${fieldName}.blendMode`);
  let next: AppearanceItem = {
    ...item,
    ...(name !== undefined ? { name } : {}),
    ...(visible !== undefined ? { visible } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(blendMode !== undefined ? { blendMode } : {}),
  };

  if (input.color !== undefined) {
    if (next.kind !== 'color-fill' && next.kind !== 'stroke') {
      throw new Error(`${fieldName}.color is only valid for color-fill or stroke`);
    }
    next = {
      ...next,
      color: parseMotionColor(input.color, `${fieldName}.color`),
    };
  }

  if (
    input.width !== undefined
    || input.alignment !== undefined
  ) {
    if (next.kind !== 'stroke') {
      throw new Error(`${fieldName}.width/alignment are only valid for stroke`);
    }
    const width = optionalFiniteNumber(
      input.width,
      `${fieldName}.width`,
      0,
      10000,
    );
    const alignment = input.alignment;
    if (
      alignment !== undefined
      && alignment !== 'center'
      && alignment !== 'inside'
      && alignment !== 'outside'
    ) {
      throw new Error(`${fieldName}.alignment must be one of: center, inside, outside`);
    }
    next = {
      ...next,
      ...(width !== undefined ? { width } : {}),
      ...(alignment !== undefined
        ? { alignment: alignment as StrokeAppearance['alignment'] }
        : {}),
    };
  }

  if (
    input.stops !== undefined
    || input.start !== undefined
    || input.end !== undefined
    || input.center !== undefined
    || input.radius !== undefined
  ) {
    if (next.kind !== 'linear-gradient' && next.kind !== 'radial-gradient') {
      throw new Error(`${fieldName} gradient fields require a gradient appearance`);
    }
    const normalizedStops = input.stops === undefined
      ? undefined
      : normalizeGradientStops(
          input.stops,
          `${fieldName}.stops`,
          next.stops,
        );
    if (next.kind === 'linear-gradient') {
      if (input.center !== undefined || input.radius !== undefined) {
        throw new Error(`${fieldName}.center/radius require a radial gradient`);
      }
      const start = normalizeVector(
        input.start,
        `${fieldName}.start`,
        next.start,
      );
      const end = normalizeVector(
        input.end,
        `${fieldName}.end`,
        next.end,
      );
      next = {
        ...next,
        ...(normalizedStops ? { stops: normalizedStops.stops } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
      };
    } else {
      if (input.start !== undefined || input.end !== undefined) {
        throw new Error(`${fieldName}.start/end require a linear gradient`);
      }
      const center = normalizeVector(
        input.center,
        `${fieldName}.center`,
        next.center,
      );
      const radius = optionalFiniteNumber(
        input.radius,
        `${fieldName}.radius`,
        0.001,
        10,
      );
      next = {
        ...next,
        ...(normalizedStops ? { stops: normalizedStops.stops } : {}),
        ...(center ? { center } : {}),
        ...(radius !== undefined ? { radius } : {}),
      };
    }
    return {
      item: next,
      createdGradientStopIds: normalizedStops?.createdIds ?? [],
    };
  }

  return { item: next, createdGradientStopIds: [] };
}

function normalizeGradientStops(
  value: unknown,
  fieldName: string,
  existingStops: readonly GradientStop[],
): { stops: GradientStop[]; createdIds: string[] } {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${fieldName} must contain at least two stops`);
  }
  if (value.length > MOTION_MAX_GRADIENT_STOPS) {
    throw new Error(
      `${fieldName} may contain at most ${MOTION_MAX_GRADIENT_STOPS} stops`,
    );
  }
  const existingIds = new Set(existingStops.map((stop) => stop.id));
  const seenIds = new Set<string>();
  const createdIds: string[] = [];
  const stops = value.map((stopInput, index): GradientStop => {
    if (!isRecord(stopInput)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }
    const suppliedId = optionalNonEmptyString(
      stopInput.id,
      `${fieldName}[${index}].id`,
    );
    if (suppliedId instanceof Error) throw suppliedId;
    if (suppliedId && !existingIds.has(suppliedId)) {
      throw new Error(`${fieldName}[${index}].id is not an existing stop id`);
    }
    const id = suppliedId ?? createMotionAppearanceId('stop');
    if (seenIds.has(id)) {
      throw new Error(`${fieldName} contains duplicate stop id: ${id}`);
    }
    seenIds.add(id);
    if (!suppliedId) createdIds.push(id);
    return {
      id,
      offset: validateFiniteNumber(
        stopInput.offset,
        `${fieldName}[${index}].offset`,
        0,
        1,
      ),
      color: parseMotionColor(
        stopInput.color,
        `${fieldName}[${index}].color`,
      ),
    };
  });
  stops.sort((left, right) => left.offset - right.offset);
  return { stops, createdIds };
}

function normalizeVector(
  value: unknown,
  fieldName: string,
  fallback: MotionVector2,
): MotionVector2 | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const x = optionalFiniteNumber(value.x, `${fieldName}.x`, -10, 10);
  const y = optionalFiniteNumber(value.y, `${fieldName}.y`, -10, 10);
  if (x === undefined && y === undefined) {
    throw new Error(`${fieldName} must include x and/or y`);
  }
  return {
    x: x ?? fallback.x,
    y: y ?? fallback.y,
  };
}

function normalizeBlendMode(
  value: unknown,
  fieldName: string,
): AppearanceItem['blendMode'] | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string'
    || !MOTION_APPEARANCE_BLEND_MODES.includes(
      value as (typeof MOTION_APPEARANCE_BLEND_MODES)[number],
    )
  ) {
    throw new Error(
      `${fieldName} must be one of: ${MOTION_APPEARANCE_BLEND_MODES.join(', ')}`,
    );
  }
  return value as (typeof MOTION_APPEARANCE_BLEND_MODES)[number];
}

function normalizeInsertIndex(
  value: unknown,
  maximum: number,
  fieldName: string,
): number {
  if (value === undefined) return maximum;
  return validateInteger(value, fieldName, 0, maximum);
}

function validateAppearanceStack(motion: MotionLayerDefinition): void {
  const items = motion.appearance?.items ?? [];
  if (items.length > MOTION_MAX_APPEARANCES) {
    throw new Error(
      `The current renderer supports at most ${MOTION_MAX_APPEARANCES} appearance items`,
    );
  }
  for (const item of items) {
    if (item.kind === 'texture-fill') {
      throw new Error('Texture fills are reserved for Motion Design MD5');
    }
    if (
      (item.kind === 'linear-gradient' || item.kind === 'radial-gradient')
      && (item.stops.length < 2 || item.stops.length > MOTION_MAX_GRADIENT_STOPS)
    ) {
      throw new Error(
        `${item.name} must contain between 2 and ${MOTION_MAX_GRADIENT_STOPS} gradient stops`,
      );
    }
  }
}

function requiredNonEmptyString(value: unknown, fieldName: string): string | Error {
  if (typeof value !== 'string' || !value.trim()) {
    return new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function optionalNonEmptyString(
  value: unknown,
  fieldName: string,
): string | undefined | Error {
  if (value === undefined) return undefined;
  return requiredNonEmptyString(value, fieldName);
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  return validateFiniteNumber(value, fieldName, min, max);
}

function optionalInteger(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): number | undefined {
  const number = optionalFiniteNumber(value, fieldName, min, max);
  if (number !== undefined && !Number.isInteger(number)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return number;
}

function validateInteger(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): number {
  const number = validateFiniteNumber(value, fieldName, min, max);
  if (!Number.isInteger(number)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(error: string): ToolResult {
  return { success: false, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Motion Design error';
}

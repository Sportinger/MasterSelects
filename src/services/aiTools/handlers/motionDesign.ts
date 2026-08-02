import {
  createColorFillAppearance,
  createDefaultReplicatorDefinition,
  createLinearGradientAppearance,
  createMotionAppearanceId,
  createMotionExpressionBinding,
  createRadialGradientAppearance,
  createStrokeAppearance,
  createTextureFillAppearance,
  MOTION_PATH_MAX_VERTICES,
  MOTION_APPEARANCE_BLEND_MODES,
  type AppearanceItem,
  type ColorFillAppearance,
  type GradientStop,
  type MotionColor,
  type MotionLayerDefinition,
  type MotionPathVertex,
  type MotionExpressionBinding,
  type MotionVector2,
  type StrokeAppearance,
  type TextureFillAppearance,
} from '../../../types/motionDesign';
import {
  MOTION_MAX_APPEARANCES,
  MOTION_MAX_GRADIENT_STOPS,
} from '../../../engine/motion/MotionBuffers';
import { MOTION_REPLICATOR_SHADER_MAX_INSTANCES } from '../../../engine/motion/MotionTypes';
import type { TimelineClip } from '../../../types/timeline';
import type { Keyframe } from '../../../types/keyframes';
import type { PropertyDescriptor } from '../../../types/propertyRegistry';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { getTimelineRevision } from '../../../stores/timeline/revisionMiddleware';
import { getPlayheadPosition } from '../../layerBuilder/PlayheadState';
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
  type MutationEntitySnapshot,
} from './mutationEntityResults';
import { normalizeMotionReplicatorBundle } from '../../motionDesign/contracts/replicatorTimelineAdapter';
import { planMotionReplicatorSemanticOperation } from '../../motionDesign/replicator/semanticOperations';
import { getTimelineMotionStructureGraphRevision } from '../../motionDesign/contracts/timelineStructureAdapter';
import { applyTimelineMotionAdjustmentMutation } from '../../motionDesign/adjustment/timelineMutationAdapter';
import { planMotionModifierSemanticOperation, type MotionModifierSemanticOperation } from '../../motionDesign/modifiers/semanticOperations';
import { MOTION_MODIFIER_MAX_ABS_AMOUNT, MOTION_MODIFIER_TARGET_PATHS, parseMotionModifierStackContract } from '../../motionDesign/modifiers/contracts';
import { compileMotionExpression } from '../../motionDesign/expressions/validator';
import { applyMotionAppearancePreset, createMotionAppearancePreset } from '../../motionDesign/appearancePresets';
import { getMotionAppearancePresetFromLibrary, listMotionAppearancePresets, saveMotionAppearancePresetToLibrary } from '../../motionDesign/presetLibrary';
import { getMotionTemplateFromLibrary, listMotionTemplates, saveMotionTemplateToLibrary } from '../../motionDesign/motionTemplateLibrary';
import { decodeMotionTemplateEnvelope, encodeMotionTemplateEnvelope } from '../../motionDesign/templates/codec';
import { inventoryMotionTemplateDependencies } from '../../motionDesign/templates/dependencyInventory';
import { planMotionTemplateIdRemap } from '../../motionDesign/templates/idRemapPlanner';
import { planMotionTemplateInstantiation } from '../../motionDesign/templates/instantiatePlanner';
import type {
  MotionTemplateDependencyInventoryEntry,
  MotionTemplateEnvelopeV1,
  MotionTemplateInstantiateOperation,
} from '../../motionDesign/templates/contracts';
import { startBatch, endBatch } from '../../../stores/historyStore';

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

export async function handleSetMotionParent(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  try {
    const operation = requiredNonEmptyString(args.operation, 'operation');
    if (operation instanceof Error) return failure(operation.message);
    if (operation !== 'set' && operation !== 'clear') {
      return failure('operation must be one of: set, clear');
    }
    const childClipId = requiredNonEmptyString(args.childClipId, 'childClipId');
    if (childClipId instanceof Error) return failure(childClipId.message);
    const child = timelineStore.clips.find((clip) => clip.id === childClipId);
    if (!child) return failure(`Clip not found: ${childClipId}`);
    const childTrack = timelineStore.tracks.find((track) => track.id === child.trackId);
    if (childTrack?.locked === true) return failure(`Track is locked: ${childTrack.id}`);

    let parentClipId: string | null = null;
    if (operation === 'set') {
      const parsedParentId = requiredNonEmptyString(args.parentClipId, 'parentClipId');
      if (parsedParentId instanceof Error) return failure(parsedParentId.message);
      if (!timelineStore.clips.some((clip) => clip.id === parsedParentId)) {
        return failure(`Clip not found: ${parsedParentId}`);
      }
      parentClipId = parsedParentId;
    } else if (args.parentClipId !== undefined) {
      return failure('parentClipId must be omitted when operation is clear');
    }
    if ((child.parentClipId ?? null) === parentClipId) {
      return failure(`Clip ${childClipId} already has the requested parent state`);
    }

    const mutationSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);
    const keyframeSnapshot = captureMutationEntitySnapshot(
      'keyframe',
      flattenTimelineKeyframes(timelineStore.clipKeyframes),
    );
    useTimelineStore.getState().setClipParent(childClipId, parentClipId);
    const clipsAfter = useTimelineStore.getState().clips;
    const childAfter = clipsAfter.find((clip) => clip.id === childClipId);
    const appliedParentId = childAfter?.parentClipId ?? null;
    if (!childAfter || appliedParentId !== parentClipId) {
      return failure('Motion parent operation was rejected by the timeline graph');
    }

    return {
      success: true,
      data: {
        operation,
        childClipId,
        parentClipId,
        ...describeMotionParentMutationEntities({
          clipSnapshot: mutationSnapshot,
          keyframeSnapshot,
          clipsAfter,
          keyframesAfter: useTimelineStore.getState().clipKeyframes,
          updatedClipIds: [childClipId],
        }),
      },
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function handleCreateMotionNullAndParent(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  try {
    const compositionId = useMediaStore.getState().activeCompositionId ?? 'timeline:active';
    const graphRevisionBefore = getTimelineMotionStructureGraphRevision(
      compositionId,
      timelineStore.clips,
    );
    const trackResult = resolveVideoTrack(args.trackId, timelineStore);
    if (!trackResult.success) return trackResult.result;
    if (!Array.isArray(args.clipIds) || args.clipIds.length < 1 || args.clipIds.length > 100) {
      return failure('clipIds must be an array containing between 1 and 100 clip ids');
    }
    const clipIds: string[] = [];
    const seenClipIds = new Set<string>();
    for (let index = 0; index < args.clipIds.length; index += 1) {
      const clipId = requiredNonEmptyString(args.clipIds[index], `clipIds[${index}]`);
      if (clipId instanceof Error) return failure(clipId.message);
      if (seenClipIds.has(clipId)) return failure(`clipIds contains duplicate id: ${clipId}`);
      seenClipIds.add(clipId);
      clipIds.push(clipId);
    }
    for (const clipId of clipIds) {
      const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return failure(`Clip not found: ${clipId}`);
      const track = timelineStore.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked === true) return failure(`Track is locked: ${track.id}`);
    }
    const timelineTime = args.timelineTime === undefined
      ? getPlayheadPosition(timelineStore.playheadPosition)
      : validateFiniteNumber(args.timelineTime, 'timelineTime', 0, Number.MAX_SAFE_INTEGER);
    const duration = args.duration === undefined
      ? 5
      : validateFiniteNumber(args.duration, 'duration', 0.001, Number.MAX_SAFE_INTEGER);
    const mutationSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);
    const keyframeSnapshot = captureMutationEntitySnapshot(
      'keyframe',
      flattenTimelineKeyframes(timelineStore.clipKeyframes),
    );
    const clipId = useTimelineStore.getState().addMotionNullAndParentSelected(
      trackResult.track.id,
      timelineTime,
      clipIds,
      duration,
    );
    if (!clipId) return failure('The timeline could not create and apply the Motion Null transaction');

    const clipsAfter = useTimelineStore.getState().clips;
    const nullClip = clipsAfter.find((clip) => clip.id === clipId);
    if (
      !nullClip
      || nullClip.source?.type !== 'motion-null'
      || clipIds.some((childId) => (
        clipsAfter.find((clip) => clip.id === childId)?.parentClipId !== clipId
      ))
    ) {
      return failure('The Motion Null transaction did not reach its requested final state');
    }

    return {
      success: true,
      data: {
        operation: 'create-motion-null-and-parent',
        clipId,
        affectedClipIds: [clipId, ...clipIds],
        parentedClipIds: clipIds,
        trackId: nullClip.trackId,
        startTime: nullClip.startTime,
        duration: nullClip.duration,
        timelineTime,
        graphRevisionBefore,
        graphRevisionAfter: getTimelineMotionStructureGraphRevision(compositionId, clipsAfter),
        diagnostics: [],
        history: {
          mode: 'single-entry',
          label: 'Create Null and Parent Selection',
          atomic: true,
        },
        ...describeMotionParentMutationEntities({
          clipSnapshot: mutationSnapshot,
          keyframeSnapshot,
          clipsAfter,
          keyframesAfter: useTimelineStore.getState().clipKeyframes,
          updatedClipIds: clipIds,
        }),
      },
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function handleCreateMotionNull(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const operation = 'create-motion-null';
  const compositionId = useMediaStore.getState().activeCompositionId ?? 'timeline:active';
  const stateRevisionBefore = getTimelineRevision();
  const graphRevisionBefore = getTimelineMotionStructureGraphRevision(
    compositionId,
    timelineStore.clips,
  );
  const reject = (code: string, message: string, affectedClipIds: readonly string[] = []): ToolResult => ({
    success: false,
    error: message,
    data: {
      operation,
      affectedClipIds: [...affectedClipIds],
      graphRevisionBefore,
      graphRevisionAfter: getTimelineMotionStructureGraphRevision(
        compositionId,
        useTimelineStore.getState().clips,
      ),
      stateRevisionBefore,
      stateRevisionAfter: getTimelineRevision(),
      diagnostics: [{ code, message, affectedClipIds: [...affectedClipIds] }],
    },
  });

  try {
    const trackResult = resolveVideoTrack(args.trackId, timelineStore);
    if (!trackResult.success) {
      return reject(
        'MD6_STRUCTURE_CREATE_NULL_TRACK_INVALID',
        trackResult.result.error ?? 'No unlocked video track is available for a Motion Null',
      );
    }
    const startTime = args.startTime === undefined
      ? getPlayheadPosition(timelineStore.playheadPosition)
      : validateFiniteNumber(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
    const duration = args.duration === undefined
      ? 5
      : validateFiniteNumber(args.duration, 'duration', 0.001, Number.MAX_SAFE_INTEGER);
    const parsedName = args.name === undefined
      ? 'Null'
      : requiredNonEmptyString(args.name, 'name');
    if (parsedName instanceof Error) {
      return reject('MD6_STRUCTURE_CREATE_NULL_NAME_INVALID', parsedName.message);
    }
    if (parsedName.length > 120) {
      return reject(
        'MD6_STRUCTURE_CREATE_NULL_NAME_INVALID',
        'name must contain at most 120 characters',
      );
    }

    const mutationSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);
    const clipId = useTimelineStore.getState().addMotionNullClip(
      trackResult.track.id,
      startTime,
      duration,
      parsedName,
    );
    if (!clipId) {
      return reject(
        'MD6_STRUCTURE_CREATE_NULL_REJECTED',
        'The timeline could not create the Motion Null',
      );
    }
    const clipsAfter = useTimelineStore.getState().clips;
    const nullClip = clipsAfter.find((clip) => clip.id === clipId);
    if (
      !nullClip
      || nullClip.source?.type !== 'motion-null'
      || nullClip.trackId !== trackResult.track.id
      || nullClip.startTime !== startTime
      || nullClip.duration !== duration
      || nullClip.name !== parsedName
    ) {
      return reject(
        'MD6_STRUCTURE_CREATE_NULL_POSTCONDITION_FAILED',
        'The Motion Null did not reach its requested final state',
        [clipId],
      );
    }
    const mutationReceipt = describeMutationEntities(mutationSnapshot, clipsAfter);
    return {
      success: true,
      data: {
        operation,
        clipId,
        affectedClipIds: [clipId],
        trackId: nullClip.trackId,
        startTime: nullClip.startTime,
        duration: nullClip.duration,
        name: nullClip.name,
        graphRevisionBefore,
        graphRevisionAfter: getTimelineMotionStructureGraphRevision(compositionId, clipsAfter),
        diagnostics: [],
        history: { mode: 'single-entry', label: 'Create Null', atomic: true },
        ...mutationReceipt,
      },
    };
  } catch (error) {
    return reject(
      'MD6_STRUCTURE_CREATE_NULL_INVALID_INPUT',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function handleEditMotionAdjustment(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);
  const effectSnapshot = captureMutationEntitySnapshot(
    'effect',
    timelineStore.clips.flatMap((clip) => clip.effects),
  );
  const result = applyTimelineMotionAdjustmentMutation(args);
  if (!result.ok) {
    return {
      success: false,
      error: result.failure.message,
      data: result.failure,
    };
  }

  const clipsAfter = useTimelineStore.getState().clips;
  const effectMutation = describeMutationEntities(
    effectSnapshot,
    clipsAfter.flatMap((clip) => clip.effects),
  );
  if (result.receipt.operation !== 'remove') {
    selectClipAndOpenTab(result.receipt.clipId, 'adjustment');
  }
  return {
    success: true,
    data: {
      ...result.receipt,
      ...describeMutationEntities(clipSnapshot, clipsAfter),
      effectEntities: effectMutation.entities,
    },
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
    const x = args.x === undefined
      ? undefined
      : validateFiniteNumber(args.x, 'x', -100000, 100000);
    const y = args.y === undefined
      ? undefined
      : validateFiniteNumber(args.y, 'y', -100000, 100000);
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

    const pathParameterNames = [
      'vertices',
      'closed',
      'trimStart',
      'trimEnd',
      'trimOffset',
      'dashLength',
      'dashGap',
      'dashOffset',
    ] as const;
    const providedPathParameter = pathParameterNames.find((name) => args[name] !== undefined);
    if (validatedPrimitive !== 'path' && providedPathParameter) {
      return failure(`${providedPathParameter} is only supported for path motion shapes`);
    }
    if (validatedPrimitive === 'path' && args.vertices === undefined) {
      return failure('vertices are required for path motion shapes');
    }
    const vertices = validatedPrimitive === 'path'
      ? validateMotionPathVertices(args.vertices)
      : undefined;
    const closed = validatedPrimitive === 'path'
      ? optionalBoolean(args.closed, 'closed') ?? false
      : undefined;
    const trimStart = validatedPrimitive === 'path'
      ? optionalFiniteNumber(args.trimStart, 'trimStart', 0, 1)
      : undefined;
    const trimEnd = validatedPrimitive === 'path'
      ? optionalFiniteNumber(args.trimEnd, 'trimEnd', 0, 1)
      : undefined;
    const trimOffset = validatedPrimitive === 'path'
      ? optionalFiniteNumber(args.trimOffset, 'trimOffset', 0, 1)
      : undefined;
    const dashLength = validatedPrimitive === 'path'
      ? optionalFiniteNumber(args.dashLength, 'dashLength', 0, Number.MAX_SAFE_INTEGER)
      : undefined;
    const dashGap = validatedPrimitive === 'path'
      ? optionalFiniteNumber(args.dashGap, 'dashGap', 0, Number.MAX_SAFE_INTEGER)
      : undefined;
    const dashOffset = validatedPrimitive === 'path'
      ? optionalFiniteNumber(args.dashOffset, 'dashOffset', 0, Number.MAX_SAFE_INTEGER)
      : undefined;
    if ((trimStart ?? 0) > (trimEnd ?? 1)) {
      return failure('trimStart must not exceed trimEnd');
    }

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
    if (
      cornerRadius !== undefined
      && (validatedPrimitive === 'ellipse' || validatedPrimitive === 'path')
    ) {
      return failure('cornerRadius is only supported for rectangle, polygon, or star motion shapes');
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
      || vertices !== undefined
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
            || vertices !== undefined
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
              ...(validatedPrimitive === 'path' && vertices
                ? {
                    path: {
                      vertices,
                      closed: closed ?? false,
                      ...(trimStart !== undefined
                        || trimEnd !== undefined
                        || trimOffset !== undefined
                        ? {
                            trim: {
                              start: trimStart ?? 0,
                              end: trimEnd ?? 1,
                              offset: trimOffset ?? 0,
                            },
                          }
                        : {}),
                      ...(dashLength !== undefined
                        || dashGap !== undefined
                        || dashOffset !== undefined
                        ? {
                            dash: {
                              length: dashLength ?? 0,
                              gap: dashGap ?? 0,
                              offset: dashOffset ?? 0,
                            },
                          }
                        : {}),
                    },
                  }
                : {}),
            },
          };
        }
        return applyAppearancePatches(nextMotion, fill, stroke);
      });
    }

    let finalClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
    if (!finalClip || !isMotionShapeClip(finalClip)) {
      return failure(`Created motion shape could not be resolved: ${clipId}`);
    }
    if (x !== undefined || y !== undefined) {
      const context = resolveClipPositionAuthoringContext(finalClip);
      let positionedClip: TimelineClip = finalClip;
      for (const [path, value] of [['position.x', x], ['position.y', y]] as const) {
        if (value === undefined) continue;
        positionedClip = writePropertyAuthoringValue(
          propertyRegistry,
          positionedClip,
          path,
          value,
          context,
        );
      }
      useTimelineStore.getState().updateClip(clipId, {
        transform: structuredClone(positionedClip.transform),
      });
      finalClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
      if (!finalClip || !isMotionShapeClip(finalClip)) {
        return failure(`Positioned motion shape could not be resolved: ${clipId}`);
      }
    }
    selectClipAndOpenTab(clipId, 'motion');
    return {
      success: true,
      data: {
        ...describeMotionDesignForAi(finalClip),
        commonEditablePaths: getCommonEditablePaths(finalClip),
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

export async function handleSaveMotionAppearancePreset(args: Record<string, unknown>, timelineStore: TimelineStore): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore);
  if (!clipResult.success) return clipResult.result;
  try {
    const name = requiredNonEmptyString(args.name, 'name');
    if (name instanceof Error) return failure(name.message);
    const preset = createMotionAppearancePreset(clipResult.clip.motion!.appearance ?? { version: 1, items: [] }, name);
    saveMotionAppearancePresetToLibrary(preset);
    return { success: true, data: { id: preset.id, name: preset.name, itemCount: preset.items.length, createdAt: preset.createdAt } };
  } catch (error) { return failure(errorMessage(error)); }
}

export async function handleListMotionAppearancePresets(): Promise<ToolResult> {
  const library = listMotionAppearancePresets();
  return { success: true, data: { presets: library.presets.map((preset) => ({ id: preset.id, name: preset.name, itemCount: preset.items.length, createdAt: preset.createdAt })), warnings: library.warnings } };
}

export async function handleApplyMotionAppearancePreset(args: Record<string, unknown>, timelineStore: TimelineStore): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore);
  if (!clipResult.success) return clipResult.result;
  const presetId = requiredNonEmptyString(args.presetId, 'presetId');
  if (presetId instanceof Error) return failure(presetId.message);
  const mode = args.mode === undefined ? 'replace' : args.mode;
  if (mode !== 'replace' && mode !== 'append') return failure('mode must be replace or append');
  const preset = getMotionAppearancePresetFromLibrary(presetId);
  if (!preset) return failure(`Appearance preset not found: ${presetId}`);
  try {
    const currentItems = clipResult.clip.motion!.appearance?.items ?? [];
    if (mode === 'append' && currentItems.length + preset.items.length > MOTION_MAX_APPEARANCES) {
      return failure(`Appending this preset exceeds the maximum of ${MOTION_MAX_APPEARANCES} appearance items`);
    }
    const applied = applyMotionAppearancePreset(clipResult.clip.motion!, preset);
    const nextMotion = mode === 'replace' ? applied.motion : {
      ...applied.motion,
      appearance: { ...applied.motion.appearance!, items: [...currentItems.map((item) => structuredClone(item)), ...applied.motion.appearance!.items] },
    };
    const mutationSnapshot = captureMutationEntitySnapshot('clip', [clipResult.clip]);
    // One updateMotionLayer invocation makes this a single undo/history transaction.
    useTimelineStore.getState().updateMotionLayer(clipResult.clip.id, () => nextMotion);
    const finalClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipResult.clip.id);
    if (!finalClip || !isMotionShapeClip(finalClip)) return failure(`Motion shape disappeared: ${clipResult.clip.id}`);
    selectClipAndOpenTab(finalClip.id, 'motion');
    return { success: true, data: { ...describeMotionDesignForAi(finalClip), presetId, mode, createdAppearanceIds: Object.values(applied.appearanceIdMap), createdGradientStopIds: Object.values(applied.gradientStopIdMap), ...describeMutationEntities(mutationSnapshot, [finalClip], { updatedEntityIds: [finalClip.id] }) } };
  } catch (error) { return failure(errorMessage(error)); }
}

/** Capture one rendered Motion Shape as an ID-free MD8 template envelope. */
export async function handleSaveMotionTemplate(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  try {
    const name = requiredNonEmptyString(args.name, 'name');
    if (name instanceof Error) return failure(name.message);
    const category = args.category === undefined
      ? 'motion-clip'
      : requiredNonEmptyString(args.category, 'category');
    if (category instanceof Error) return failure(category.message);
    const clips = resolveMotionTemplateCaptureClips(args, timelineStore);
    if (clips instanceof Error) return failure(clips.message);
    const captured = captureMotionTemplateEnvelope(clips, name, category);
    const { envelope, droppedParentLinks } = captured;
    const encoded = encodeMotionTemplateEnvelope(envelope);
    if (!encoded.ok) return failure(encoded.failures.map((item) => item.message).join(' '));
    saveMotionTemplateToLibrary(envelope);
    return {
      success: true,
      data: {
        id: envelope.templateId,
        name: envelope.name,
        createdAt: templateCreatedAt(envelope.templateId),
        entityCounts: countTemplateEntities(envelope),
        dependencies: envelope.dependencies.map((dependency) => ({
          id: dependency.id,
          kind: dependency.kind,
          label: dependency.label,
        })),
        droppedParentLinks,
      },
    };
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export async function handleListMotionTemplates(): Promise<ToolResult> {
  const library = listMotionTemplates();
  return {
    success: true,
    data: {
      templates: library.templates.map((template) => ({
        id: template.templateId,
        name: template.name,
        category: template.category,
        createdAt: templateCreatedAt(template.templateId),
        entityCounts: countTemplateEntities(template),
        dependencies: template.dependencies.map((dependency) => ({
          id: dependency.id,
          kind: dependency.kind,
          label: dependency.label,
        })),
      })),
      warnings: library.warnings,
    },
  };
}

/**
 * Instantiate through live domain actions. The frozen planner owns envelope
 * entity remapping; no envelope ID is used as a runtime clip/item/keyframe ID.
 */
export async function handleApplyMotionTemplate(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const templateId = requiredNonEmptyString(args.templateId, 'templateId');
  if (templateId instanceof Error) return failure(templateId.message);
  const trackResult = resolveVideoTrack(args.trackId, timelineStore);
  if (!trackResult.success) return trackResult.result;
  let startTime: number;
  try {
    startTime = validateFiniteNumber(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  } catch (error) {
    return failure(errorMessage(error));
  }
  const stored = getMotionTemplateFromLibrary(templateId);
  if (!stored) return failure(`Motion template not found: ${templateId}`);
  const decoded = decodeMotionTemplateEnvelope(stored);
  if (!decoded.ok) return failure(decoded.failures.map((item) => item.message).join(' '));

  try {
    const envelope = decoded.envelope;
    const dependencyResolutions = resolveTemplateDependencies(envelope);
    const inventory = inventoryMotionTemplateDependencies(envelope, dependencyResolutions);
    if (!inventory.ok) return failure(inventory.failures.map((item) => item.message).join(' '));
    const missingDependencies = inventory.plan.entries
      .filter((entry) => entry.status === 'missing')
      .map((entry) => ({ id: entry.dependencyId, label: envelope.dependencies.find((item) => item.id === entry.dependencyId)?.label }));
    // The frozen instantiation planner intentionally fails closed for missing
    // dependencies. For this packet a missing texture is optional, so plan a
    // derived replay envelope after removing only its media binding.
    const replayEnvelope = materializeTemplateDependencyBindings(
      envelope,
      inventory.plan.entries,
    );
    const occupiedIds = collectMotionRuntimeIds(useTimelineStore.getState());
    const instanceKey = `apply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const namespace = JSON.stringify([
      useMediaStore.getState().activeCompositionId ?? 'timeline:active',
      instanceKey,
    ]);
    const remap = planMotionTemplateIdRemap(replayEnvelope, namespace, occupiedIds);
    if (!remap.ok) return failure(remap.failures.map((item) => item.message).join(' '));
    const plan = planMotionTemplateInstantiation({
      envelope: replayEnvelope,
      destinationCompositionId: useMediaStore.getState().activeCompositionId ?? 'timeline:active',
      insertionTime: startTime,
      instanceKey,
      dependencyResolutions: dependencyResolutions.filter((resolution) => replayEnvelope.dependencies.some((dependency) => dependency.id === resolution.dependencyId)),
      occupiedTargetIds: occupiedIds,
    });
    if (!plan.ok) return failure(plan.failures.map((item) => item.message).join(' '));

    const beforeRevision = getTimelineRevision();
    const batch = startBatch('Apply Motion Template');
    try {
      const created = await replayMotionTemplatePlan(plan.plan.batch.operations, trackResult.track.id);
      if (created.clipIds.length === 0) throw new Error('Motion template did not create a motion clip');
      return {
        success: true,
        data: {
          clipId: created.clipIds[0],
          clipIds: created.clipIds,
          createdTrackIds: created.createdTrackIds,
          remappedIdCount: remap.plan.length,
          missingDependencies,
          history: { mode: 'single-entry', label: 'Apply Motion Template', atomic: true },
          stateRevisions: { before: beforeRevision, timeline: getTimelineRevision() },
        },
      };
    } finally {
      if (batch.opened) endBatch();
    }
  } catch (error) {
    return failure(errorMessage(error));
  }
}

export async function handleEditMotionModifier(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore);
  if (!clipResult.success) return clipResult.result;
  try {
    const operationName = requiredNonEmptyString(args.operation, 'operation');
    if (operationName instanceof Error) return failure(operationName.message);
    if (!['add', 'update', 'remove', 'reorder', 'set-falloff', 'clear-falloff'].includes(operationName)) return failure('operation must be add, update, remove, reorder, set-falloff, or clear-falloff');
    const current = clipResult.clip.motion?.modifierStack;
    const revision = current ? parseMotionModifierStackContract(current).revision : 0;
    const expectedRevision = optionalInteger(args.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER);
    if (expectedRevision !== undefined && expectedRevision !== revision) return failure(`Stale Motion Modifier revision: expected ${expectedRevision}, current ${revision}`);
    const fields = Object.fromEntries(['seed', 'indexFrequency', 'timeFrequencyHz', 'octaves', 'lacunarity', 'persistence', 'waveform', 'frequencyHz', 'cyclesAcrossInstances', 'phaseDegrees', 'field', 'centerX', 'centerY', 'radius', 'exponent'].filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
    for (const key of ['seed', 'octaves']) if (fields[key] !== undefined) fields[key] = validateInteger(fields[key], key, key === 'seed' ? 0 : 1, key === 'seed' ? 0xffff_ffff : 8);
    for (const key of ['indexFrequency', 'timeFrequencyHz']) if (fields[key] !== undefined) fields[key] = validateFiniteNumber(fields[key], key, 0, 1000);
    for (const key of ['lacunarity']) if (fields[key] !== undefined) fields[key] = validateFiniteNumber(fields[key], key, 1, 8);
    for (const key of ['persistence']) if (fields[key] !== undefined) fields[key] = validateFiniteNumber(fields[key], key, 0, 1);
    for (const key of ['frequencyHz']) if (fields[key] !== undefined) fields[key] = validateFiniteNumber(fields[key], key, 0, 1000);
    for (const key of ['cyclesAcrossInstances']) if (fields[key] !== undefined) fields[key] = validateFiniteNumber(fields[key], key, -1000, 1000);
    for (const key of ['phaseDegrees', 'centerX', 'centerY']) if (fields[key] !== undefined) fields[key] = validateFiniteNumber(fields[key], key, -1_000_000, 1_000_000);
    if (fields.radius !== undefined) fields.radius = validateFiniteNumber(fields.radius, 'radius', Number.MIN_VALUE, 1_000_000);
    if (fields.exponent !== undefined) fields.exponent = validateFiniteNumber(fields.exponent, 'exponent', 0.01, 32);
    if (fields.waveform !== undefined && !['sine', 'triangle', 'square'].includes(fields.waveform as string)) return failure('waveform must be sine, triangle, or square');
    if (fields.field !== undefined && fields.field !== 'radial-distance') return failure('field must be radial-distance');
    const target = args.targetPath === undefined && args.targetOperation === undefined && args.targetAmount === undefined ? undefined : (() => {
      if (!MOTION_MODIFIER_TARGET_PATHS.includes(args.targetPath as never)) throw new Error(`targetPath must be one of: ${MOTION_MODIFIER_TARGET_PATHS.join(', ')}`);
      if (args.targetOperation !== 'add' && args.targetOperation !== 'multiply') throw new Error('targetOperation must be add or multiply');
      return { path: args.targetPath as string, operation: args.targetOperation as string, amount: validateFiniteNumber(args.targetAmount, 'targetAmount', -MOTION_MODIFIER_MAX_ABS_AMOUNT, MOTION_MODIFIER_MAX_ABS_AMOUNT) };
    })();
    let operation: MotionModifierSemanticOperation;
    if (operationName === 'add') { if (!['random', 'noise', 'oscillator', 'field'].includes(args.kind as string)) return failure('kind must be random, noise, oscillator, or field'); if (!target) return failure('add requires targetPath, targetOperation, and targetAmount'); operation = { type: 'add', kind: args.kind as 'random' | 'noise' | 'oscillator' | 'field', enabled: optionalBoolean(args.enabled, 'enabled'), target, fields }; }
    else if (operationName === 'update') { const modifierId = requiredNonEmptyString(args.modifierId, 'modifierId'); if (modifierId instanceof Error) return failure(modifierId.message); operation = { type: 'update', modifierId, enabled: optionalBoolean(args.enabled, 'enabled'), target, fields }; }
    else if (operationName === 'remove') { const modifierId = requiredNonEmptyString(args.modifierId, 'modifierId'); if (modifierId instanceof Error) return failure(modifierId.message); operation = { type: 'remove', modifierId }; }
    else if (operationName === 'reorder') { const modifierId = requiredNonEmptyString(args.modifierId, 'modifierId'); if (modifierId instanceof Error) return failure(modifierId.message); operation = { type: 'reorder', modifierId, newIndex: validateInteger(args.newIndex, 'newIndex', 0, Number.MAX_SAFE_INTEGER) }; }
    else if (operationName === 'set-falloff') {
      const shapeClipId = requiredNonEmptyString(args.falloffShapeClipId, 'falloffShapeClipId');
      if (shapeClipId instanceof Error) return failure(shapeClipId.message);
      // Falloff references use the referenced clip's replicator revision as the
      // staleness snapshot — the same convention the UI and the runtime's
      // shape-reference provisioning use. A mismatch fails the plan as STALE.
      const referencedClip = useTimelineStore.getState().clips.find((clip) => clip.id === shapeClipId);
      if (!referencedClip) return failure(`Falloff shape clip not found: ${shapeClipId}`);
      const referencedShapeRevision = referencedClip.motion?.replicator?.revision ?? 0;
      operation = { type: 'set-falloff', referencedShapeRevision, falloff: { shapeClipId, shapeRevision: referencedShapeRevision, feather: validateFiniteNumber(args.falloffFeather ?? 0, 'falloffFeather', 0, 10), invert: optionalBoolean(args.falloffInvert, 'falloffInvert') ?? false, clip: optionalBoolean(args.falloffClip, 'falloffClip') ?? false } };
    }
    else operation = { type: 'clear-falloff' };
    const plan = planMotionModifierSemanticOperation(current, operation);
    if (!plan.ok) return { success: false, error: plan.diagnostics[0].message, data: plan };
    const plannedStack = parseMotionModifierStackContract(plan.contract);
    const beforeIds = new Set(current?.modifiers.map((modifier) => modifier.id) ?? []);
    useTimelineStore.getState().updateMotionLayer(clipResult.clip.id, (motion) => ({ ...motion, modifierStack: plannedStack }));
    const finalClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipResult.clip.id);
    if (!finalClip || !isMotionShapeClip(finalClip)) return failure(`Motion shape disappeared: ${clipResult.clip.id}`);
    const afterIds = new Set(plannedStack.modifiers.map((modifier) => modifier.id));
    return { success: true, data: { ...describeMotionDesignForAi(finalClip), modifierStackRevision: { previous: revision, next: plannedStack.revision }, entities: { created: [...afterIds].filter((id) => !beforeIds.has(id)).map((id) => ({ id, kind: 'modifier' })), updated: operation.type === 'update' ? [{ id: operation.modifierId, kind: 'modifier' }] : [], removed: [...beforeIds].filter((id) => !afterIds.has(id)).map((id) => ({ id, kind: 'modifier' })) }, history: { mode: 'single-entry', label: 'Edit Motion Modifier' }, stateRevisions: { timeline: getTimelineRevision() } } };
  } catch (error) { return failure(errorMessage(error)); }
}

export async function handleSetMotionExpression(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipResult = findMotionShapeClip(args.clipId, timelineStore);
  if (!clipResult.success) return clipResult.result;
  try {
    if (args.operation !== 'set' && args.operation !== 'remove') {
      return failure('operation must be set or remove');
    }
    if (!MOTION_MODIFIER_TARGET_PATHS.includes(args.path as never)) {
      return failure(`path must be one of: ${MOTION_MODIFIER_TARGET_PATHS.join(', ')}`);
    }
    const path = args.path as MotionExpressionBinding['path'];
    const currentBindings = clipResult.clip.motion?.expressions?.bindings ?? [];
    const existing = currentBindings.find((binding) => binding.path === path);
    if (args.operation === 'remove') {
      if (!existing) return failure(`Motion expression binding not found for ${path}`);
      const bindings = currentBindings.filter((binding) => binding.path !== path);
      useTimelineStore.getState().updateMotionLayer(clipResult.clip.id, (motion) => ({
        ...motion,
        expressions: bindings.length > 0 ? { version: 1, bindings } : undefined,
      }));
      return {
        success: true,
        data: {
          clipId: clipResult.clip.id,
          path,
          binding: null,
          history: { mode: 'single-entry', label: 'Remove Motion Expression' },
          stateRevisions: { timeline: getTimelineRevision() },
        },
      };
    }

    const source = requiredNonEmptyString(args.source, 'source');
    if (source instanceof Error) return failure(source.message);
    const compiled = compileMotionExpression(source);
    if (!compiled.ok) {
      const expressionFailure = compiled.failures[0];
      return failure(`Invalid Motion expression at position ${expressionFailure.position}: ${expressionFailure.message}`);
    }
    const fallback = args.fallback === undefined
      ? 0
      : validateFiniteNumber(args.fallback, 'fallback', -Number.MAX_VALUE, Number.MAX_VALUE);
    const enabled = optionalBoolean(args.enabled, 'enabled') ?? true;
    const binding = createMotionExpressionBinding(
      path,
      source,
      fallback,
      enabled,
      existing?.id,
    );
    const bindings = [
      ...currentBindings.filter((candidate) => candidate.path !== path),
      binding,
    ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    useTimelineStore.getState().updateMotionLayer(clipResult.clip.id, (motion) => ({
      ...motion,
      expressions: { version: 1, bindings },
    }));
    return {
      success: true,
      data: {
        clipId: clipResult.clip.id,
        path,
        binding,
        history: { mode: 'single-entry', label: 'Set Motion Expression' },
        stateRevisions: { timeline: getTimelineRevision() },
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

  const suppliedKeys = [
    'enabled', 'layoutMode', 'countX', 'countY', 'spacingX', 'spacingY',
    'patternOffsetX', 'patternOffsetY', 'count', 'stepX', 'stepY', 'centerX',
    'centerY', 'radius', 'startAngleDegrees', 'endAngleDegrees',
    'angleSampling', 'autoOrient', 'offsetMode', 'offsetX', 'offsetY',
    'rotationDegrees', 'scaleX', 'scaleY', 'fade', 'userLimit',
  ]
    .filter((key) => args[key] !== undefined);
  if (suppliedKeys.length === 0) {
    return failure('Provide at least one Motion Replicator setting');
  }

  try {
    const enabled = optionalBoolean(args.enabled, 'enabled');
    const countX = optionalInteger(args.countX, 'countX', 1, MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS);
    const countY = optionalInteger(args.countY, 'countY', 1, MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS);
    const spacingX = optionalFiniteNumber(args.spacingX, 'spacingX', -1_000_000, 1_000_000);
    const spacingY = optionalFiniteNumber(args.spacingY, 'spacingY', -1_000_000, 1_000_000);
    const patternOffsetX = optionalFiniteNumber(args.patternOffsetX, 'patternOffsetX', -1_000_000, 1_000_000);
    const patternOffsetY = optionalFiniteNumber(args.patternOffsetY, 'patternOffsetY', -1_000_000, 1_000_000);
    const count = optionalInteger(args.count, 'count', 1, MOTION_REPLICATOR_SHADER_MAX_INSTANCES);
    const stepX = optionalFiniteNumber(args.stepX, 'stepX', -1_000_000, 1_000_000);
    const stepY = optionalFiniteNumber(args.stepY, 'stepY', -1_000_000, 1_000_000);
    const centerX = optionalFiniteNumber(args.centerX, 'centerX', -1_000_000, 1_000_000);
    const centerY = optionalFiniteNumber(args.centerY, 'centerY', -1_000_000, 1_000_000);
    const radius = optionalFiniteNumber(args.radius, 'radius', 0, 1_000_000);
    const startAngleDegrees = optionalFiniteNumber(args.startAngleDegrees, 'startAngleDegrees', -1_000_000, 1_000_000);
    const endAngleDegrees = optionalFiniteNumber(args.endAngleDegrees, 'endAngleDegrees', -1_000_000, 1_000_000);
    const autoOrient = optionalBoolean(args.autoOrient, 'autoOrient');
    const offsetX = optionalFiniteNumber(args.offsetX, 'offsetX', -1_000_000, 1_000_000);
    const offsetY = optionalFiniteNumber(args.offsetY, 'offsetY', -1_000_000, 1_000_000);
    const rotationDegrees = optionalFiniteNumber(args.rotationDegrees, 'rotationDegrees', -1_000_000, 1_000_000);
    const scaleX = optionalFiniteNumber(args.scaleX, 'scaleX', -10_000, 10_000);
    const scaleY = optionalFiniteNumber(args.scaleY, 'scaleY', -10_000, 10_000);
    const fade = optionalFiniteNumber(args.fade, 'fade', 0, 1);
    const userLimit = optionalInteger(args.userLimit, 'userLimit', 1, MOTION_REPLICATOR_SHADER_MAX_INSTANCES);
    const currentReplicator = clipResult.clip.motion?.replicator
      ? normalizeMotionReplicatorBundle(
          clipResult.clip.motion.replicator,
          clipResult.clip.motion.modifierStack,
        ).replicator
      : createDefaultReplicatorDefinition();
    const expectedRevision = optionalInteger(
      args.expectedRevision,
      'expectedRevision',
      0,
      Number.MAX_SAFE_INTEGER,
    );
    if (expectedRevision !== undefined && expectedRevision !== currentReplicator.revision) {
      return failure(
        `Stale Motion Replicator revision: expected ${expectedRevision}, current ${currentReplicator.revision}`,
      );
    }

    const layoutMode = args.layoutMode === undefined
      ? currentReplicator.layout.mode
      : args.layoutMode;
    if (layoutMode !== 'grid' && layoutMode !== 'linear' && layoutMode !== 'radial') {
      return failure('layoutMode must be grid, linear, or radial');
    }
    const angleSampling = args.angleSampling;
    if (
      angleSampling !== undefined
      && angleSampling !== 'inclusive-end'
      && angleSampling !== 'exclusive-end'
    ) {
      return failure('angleSampling must be inclusive-end or exclusive-end');
    }
    const offsetMode = args.offsetMode;
    if (offsetMode !== undefined && offsetMode !== 'cumulative' && offsetMode !== 'absolute') {
      return failure('offsetMode must be cumulative or absolute');
    }

    let plannedReplicator = currentReplicator;
    const applyPlan = (
      operation: Parameters<typeof planMotionReplicatorSemanticOperation>[1],
    ): boolean => {
      const plan = planMotionReplicatorSemanticOperation(plannedReplicator, operation);
      if (!plan.ok) return false;
      plannedReplicator = plan.contract;
      return true;
    };

    const hasLayoutInput = args.layoutMode !== undefined
      || [
        countX, countY, spacingX, spacingY, patternOffsetX, patternOffsetY,
        count, stepX, stepY, centerX, centerY, radius, startAngleDegrees,
        endAngleDegrees, angleSampling, autoOrient,
      ].some((value) => value !== undefined);
    let nextLayout = currentReplicator.layout;
    if (layoutMode === 'grid') {
      const current = currentReplicator.layout.mode === 'grid'
        ? currentReplicator.layout
        : createDefaultReplicatorDefinition().layout;
      if (current.mode !== 'grid') throw new Error('Default Replicator layout must be Grid');
      nextLayout = {
        ...current,
        count: {
          columns: countX ?? current.count.columns,
          rows: countY ?? current.count.rows,
        },
        spacing: {
          x: spacingX ?? current.spacing.x,
          y: spacingY ?? current.spacing.y,
        },
        patternOffset: {
          x: patternOffsetX ?? current.patternOffset.x,
          y: patternOffsetY ?? current.patternOffset.y,
        },
      };
    } else if (layoutMode === 'linear') {
      const current = currentReplicator.layout.mode === 'linear'
        ? currentReplicator.layout
        : { mode: 'linear' as const, count: 3, step: { x: 120, y: 0 } };
      nextLayout = {
        ...current,
        count: count ?? current.count,
        step: { x: stepX ?? current.step.x, y: stepY ?? current.step.y },
      };
    } else {
      const current = currentReplicator.layout.mode === 'radial'
        ? currentReplicator.layout
        : {
            mode: 'radial' as const,
            count: 8,
            center: { x: 0, y: 0 },
            radius: 180,
            startAngleDegrees: 0,
            endAngleDegrees: 360,
            angleSampling: 'exclusive-end' as const,
            autoOrient: false,
          };
      nextLayout = {
        ...current,
        count: count ?? current.count,
        center: { x: centerX ?? current.center.x, y: centerY ?? current.center.y },
        radius: radius ?? current.radius,
        startAngleDegrees: startAngleDegrees ?? current.startAngleDegrees,
        endAngleDegrees: endAngleDegrees ?? current.endAngleDegrees,
        angleSampling: angleSampling ?? current.angleSampling,
        autoOrient: autoOrient ?? current.autoOrient,
      };
    }
    if (hasLayoutInput && !applyPlan({
      type: 'set-layout',
      expectedRevision: plannedReplicator.revision,
      layout: nextLayout,
    })) {
      return failure('Motion Replicator layout failed contract validation');
    }

    const hasTerminalInput = [
      offsetMode, offsetX, offsetY, rotationDegrees, scaleX, scaleY, fade,
    ].some((value) => value !== undefined);
    if (hasTerminalInput && !applyPlan({
      type: 'set-terminal-transform',
      expectedRevision: plannedReplicator.revision,
      terminalTransform: {
        ...plannedReplicator.terminalTransform,
        mode: offsetMode ?? plannedReplicator.terminalTransform.mode,
        position: {
          x: offsetX ?? plannedReplicator.terminalTransform.position.x,
          y: offsetY ?? plannedReplicator.terminalTransform.position.y,
        },
        rotationDegrees: rotationDegrees ?? plannedReplicator.terminalTransform.rotationDegrees,
        scale: {
          x: scaleX ?? plannedReplicator.terminalTransform.scale.x,
          y: scaleY ?? plannedReplicator.terminalTransform.scale.y,
        },
        opacity: fade ?? plannedReplicator.terminalTransform.opacity,
      },
    })) {
      return failure('Motion Replicator terminal transform failed contract validation');
    }
    if (userLimit !== undefined && !applyPlan({
      type: 'set-user-limit',
      expectedRevision: plannedReplicator.revision,
      userLimit,
    })) {
      return failure('Motion Replicator user limit failed contract validation');
    }
    if (enabled !== undefined && !applyPlan({
      type: 'set-enabled',
      expectedRevision: plannedReplicator.revision,
      enabled,
    })) {
      return failure('Motion Replicator enabled state failed contract validation');
    }

    const mutationSnapshot = captureMutationEntitySnapshot('clip', [clipResult.clip]);
    useTimelineStore.getState().updateMotionLayer(clipResult.clip.id, (motion) => ({
      ...motion,
      replicator: plannedReplicator,
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
        replicatorRevision: {
          previous: currentReplicator.revision,
          next: plannedReplicator.revision,
        },
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
    commonEditablePaths: getCommonEditablePaths(clip),
  };
}

function getCommonEditablePaths(clip: TimelineClip): Record<string, string> {
  const primitive = clip.motion?.shape?.primitive;
  return {
    x: 'position.x',
    y: 'position.y',
    width: 'shape.size.w',
    height: 'shape.size.h',
    ...(primitive === 'rectangle' ? { cornerRadius: 'shape.cornerRadius' } : {}),
    ...(primitive === 'path'
      ? {
          trimStart: 'shape.path.trim.start',
          trimEnd: 'shape.path.trim.end',
          trimOffset: 'shape.path.trim.offset',
          dashLength: 'shape.path.dash.length',
          dashGap: 'shape.path.dash.gap',
          dashOffset: 'shape.path.dash.offset',
        }
      : {}),
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

function resolveMotionTemplateCaptureClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): TimelineClip[] | Error {
  const hasClipId = args.clipId !== undefined;
  const hasClipIds = args.clipIds !== undefined;
  if (hasClipId === hasClipIds) {
    return new Error('Provide exactly one of clipId or clipIds');
  }
  const requestedIds: string[] = [];
  if (hasClipId) {
    const clipId = requiredNonEmptyString(args.clipId, 'clipId');
    if (clipId instanceof Error) return clipId;
    requestedIds.push(clipId);
  } else {
    if (!Array.isArray(args.clipIds) || args.clipIds.length < 1 || args.clipIds.length > 8) {
      return new Error('clipIds must be an array containing between 1 and 8 clip ids');
    }
    const seen = new Set<string>();
    for (let index = 0; index < args.clipIds.length; index += 1) {
      const clipId = requiredNonEmptyString(args.clipIds[index], `clipIds[${index}]`);
      if (clipId instanceof Error) return clipId;
      if (seen.has(clipId)) return new Error(`clipIds contains duplicate id: ${clipId}`);
      seen.add(clipId);
      requestedIds.push(clipId);
    }
  }
  const clips: TimelineClip[] = [];
  for (const clipId of requestedIds) {
    const result = findMotionShapeClip(clipId, timelineStore, true);
    if (!result.success) return new Error(result.result.error ?? `Motion shape clip not found: ${clipId}`);
    clips.push(result.clip);
  }
  return clips;
}

function captureMotionTemplateEnvelope(
  clips: readonly TimelineClip[],
  name: string,
  category: string,
): {
  envelope: MotionTemplateEnvelopeV1;
  droppedParentLinks: Array<{ clipId: string; parentClipId: string }>;
} {
  if (clips.length === 0) throw new Error('Motion template capture requires at least one clip');
  if (clips.some((clip) => !clip.motion?.shape)) {
    throw new Error('Motion template capture requires motion shape definitions');
  }
  const templateId = `motion-template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dependencies: Array<MotionTemplateEnvelopeV1['dependencies'][number]> = [];
  const relationships: MotionTemplateEnvelopeV1['relationships'][number][] = [];
  const dependencyByMediaId = new Map<string, string>();
  const mediaFiles = useMediaStore.getState().files;
  const minimumStartTime = Math.min(...clips.map((clip) => clip.startTime));
  const entityIdByClipId = new Map(clips.map((clip, index) => [clip.id, `clip-${index}`]));
  const droppedParentLinks: Array<{ clipId: string; parentClipId: string }> = [];
  const dependencyForMedia = (mediaFileId: string): string => {
    const known = dependencyByMediaId.get(mediaFileId);
    if (known) return known;
    const id = `media-${dependencyByMediaId.size}`;
    dependencyByMediaId.set(mediaFileId, id);
    dependencies.push({
      id,
      kind: 'media',
      sourceProjectId: mediaFileId,
      label: mediaFiles.find((file) => file.id === mediaFileId)?.name ?? mediaFileId,
    });
    return id;
  };
  const entities: MotionTemplateEnvelopeV1['entities'][number][] = [];
  for (const [clipIndex, clip] of clips.entries()) {
    const ownerId = `clip-${clipIndex}`;
    const owns = (entityId: string): void => {
      relationships.push({
        id: `owns-${ownerId}-${entityId}`,
        kind: 'owns-op',
        fromEntityId: ownerId,
        toEntityId: entityId,
        payload: {},
      });
    };
    const replicator = clip.motion!.replicator ?? createDefaultReplicatorDefinition();
    entities.push({
      id: ownerId,
      kind: 'motion-clip',
      startOffset: clip.startTime - minimumStartTime,
      duration: clip.duration,
      payload: toTemplateJson({
        name: clip.name,
        duration: clip.duration,
        shape: clip.motion!.shape,
        replicator: {
          enabled: replicator.enabled,
          layout: replicator.layout,
          terminalTransform: replicator.terminalTransform,
          userLimit: replicator.userLimit ?? null,
        },
      }) as never,
      dependencyIds: [],
    });
    for (const [index, item] of (clip.motion!.appearance?.items ?? []).entries()) {
      const id = `appearance-${clipIndex}-${index}`;
      const dependencyIds = item.kind === 'texture-fill' && item.mediaFileId
        ? [dependencyForMedia(item.mediaFileId)]
        : [];
      entities.push({ id, kind: 'appearance-op', startOffset: 0, duration: clip.duration, payload: toTemplateJson(appearanceAddPayload(item)) as never, dependencyIds });
      owns(id);
    }
    for (const [index, modifier] of (clip.motion!.modifierStack?.modifiers ?? []).entries()) {
      const id = `modifier-${clipIndex}-${index}`;
      entities.push({ id, kind: 'modifier-op', startOffset: 0, duration: clip.duration, payload: toTemplateJson(modifierAddPayload(modifier)) as never, dependencyIds: [] });
      owns(id);
    }
    const byPath: Record<string, unknown[]> = {};
    for (const keyframe of clipKeyframesFor(clip.id)) {
      const values = byPath[keyframe.property] ?? [];
      values.push(toTemplateJson({
        time: keyframe.time,
        value: keyframe.value,
        easing: keyframe.easing,
        ...(keyframe.rotationInterpolation ? { rotationInterpolation: keyframe.rotationInterpolation } : {}),
        ...(keyframe.handleIn ? { handleIn: keyframe.handleIn } : {}),
        ...(keyframe.handleOut ? { handleOut: keyframe.handleOut } : {}),
      }));
      byPath[keyframe.property] = values;
    }
    const keyframesId = `keyframes-${clipIndex}`;
    entities.push({ id: keyframesId, kind: 'keyframes', startOffset: 0, duration: clip.duration, payload: toTemplateJson({ byPath }) as never, dependencyIds: [] });
    owns(keyframesId);
    for (const [index, binding] of (clip.motion!.expressions?.bindings ?? []).entries()) {
      const id = `expression-${clipIndex}-${index}`;
      entities.push({
        id,
        kind: 'expression-op',
        startOffset: 0,
        duration: clip.duration,
        payload: toTemplateJson({ path: binding.path, source: binding.source, fallback: binding.fallback, enabled: binding.enabled }) as never,
        dependencyIds: [],
      });
      owns(id);
    }
    if (clip.parentClipId) {
      const parentEntityId = entityIdByClipId.get(clip.parentClipId);
      if (parentEntityId) {
        relationships.push({ id: `motion-parent-${clipIndex}`, kind: 'motion-parent', fromEntityId: ownerId, toEntityId: parentEntityId, payload: {} });
      } else {
        droppedParentLinks.push({ clipId: clip.id, parentClipId: clip.parentClipId });
      }
    }
  }
  return { envelope: {
    format: 'masterselects.msmotion',
    version: 1,
    scope: 'project-local',
    templateId,
    name: name.trim(),
    category: category.trim(),
    duration: Math.max(...clips.map((clip) => clip.startTime + clip.duration)) - minimumStartTime,
    entities,
    relationships,
    dependencies,
  }, droppedParentLinks };
}

async function replayMotionTemplatePlan(
  operations: readonly MotionTemplateInstantiateOperation[],
  trackId: string,
): Promise<{ clipIds: string[]; createdTrackIds: string[] }> {
  const entityOperations = operations.filter((operation): operation is Extract<MotionTemplateInstantiateOperation, { type: 'create-entity' }> => operation.type === 'create-entity');
  const clipOperations = entityOperations
    .map((operation, envelopeOrder) => ({ operation, envelopeOrder }))
    .filter((item) => item.operation.entityKind === 'motion-clip')
    .sort((left, right) => left.operation.startTime - right.operation.startTime || left.envelopeOrder - right.envelopeOrder);
  if (clipOperations.length === 0) return { clipIds: [], createdTrackIds: [] };
  const createdClipIdByEntityId = new Map<string, string>();
  const createdTrackIds: string[] = [];
  for (const [index, item] of clipOperations.entries()) {
    const targetTrackId = index === 0 ? trackId : useTimelineStore.getState().addTrack('video');
    if (index > 0) createdTrackIds.push(targetTrackId);
    createdClipIdByEntityId.set(
      item.operation.targetEntityId,
      await replayMotionClipEntity(item.operation, targetTrackId),
    );
  }
  const ownerEntityIdByOpEntityId = new Map<string, string>();
  const parentEntityIdByChildEntityId = new Map<string, string>();
  for (const operation of operations) {
    if (operation.type !== 'create-relationship') continue;
    if (operation.relationshipKind === 'owns-op') {
      ownerEntityIdByOpEntityId.set(operation.toEntityId, operation.fromEntityId);
    } else if (operation.relationshipKind === 'motion-parent') {
      parentEntityIdByChildEntityId.set(operation.fromEntityId, operation.toEntityId);
    }
  }
  const legacyOwnerEntityId = clipOperations[0].operation.targetEntityId;
  const rank: Record<string, number> = {
    'appearance-op': 0,
    'modifier-op': 1,
    keyframes: 2,
    'expression-op': 3,
  };
  for (const operation of [...entityOperations].sort((left, right) => (
    (rank[left.entityKind] ?? Number.MAX_SAFE_INTEGER) - (rank[right.entityKind] ?? Number.MAX_SAFE_INTEGER)
  ))) {
    if (operation.entityKind === 'motion-clip') continue;
    const ownerEntityId = ownerEntityIdByOpEntityId.get(operation.targetEntityId)
      ?? (ownerEntityIdByOpEntityId.size === 0 ? legacyOwnerEntityId : undefined);
    if (!ownerEntityId) throw new Error(`Motion template operation has no owner relationship: ${operation.entityKind}`);
    const clipId = createdClipIdByEntityId.get(ownerEntityId);
    if (!clipId) throw new Error(`Motion template operation has no created owner clip: ${operation.entityKind}`);
    if (operation.entityKind === 'appearance-op') {
      // Awaiting keeps every mutation inside the open history batch and in
      // template order, and lets domain-level rejections fail the apply.
      const result = await handleUpdateMotionAppearances({
        clipId,
        operations: [{ operation: 'add', ...operation.payload }],
      }, useTimelineStore.getState());
      if (!result.success) {
        throw new Error(result.error ?? 'Motion template appearance operation was rejected');
      }
    } else if (operation.entityKind === 'modifier-op') {
      await replayModifierEntity(clipId, operation.payload);
    } else if (operation.entityKind === 'keyframes') {
      replayKeyframesEntity(clipId, operation.payload);
    } else if (operation.entityKind === 'expression-op') {
      const payload = operation.payload as Record<string, unknown>;
      const result = await handleSetMotionExpression({
        clipId,
        operation: 'set',
        path: payload.path,
        source: payload.source,
        fallback: payload.fallback,
        enabled: payload.enabled,
      }, useTimelineStore.getState());
      if (!result.success) throw new Error(result.error ?? 'Motion template expression operation was rejected');
    } else {
      throw new Error(`Unsupported motion template entity kind: ${operation.entityKind}`);
    }
  }
  for (const [childEntityId, parentEntityId] of parentEntityIdByChildEntityId) {
    const childClipId = createdClipIdByEntityId.get(childEntityId);
    const parentClipId = createdClipIdByEntityId.get(parentEntityId);
    if (!childClipId || !parentClipId) throw new Error('Motion template parent relationship references an unknown created clip');
    useTimelineStore.getState().setClipParent(childClipId, parentClipId);
    if (useTimelineStore.getState().clips.find((clip) => clip.id === childClipId)?.parentClipId !== parentClipId) {
      throw new Error('Motion template parent relationship was rejected by the timeline graph');
    }
  }
  return { clipIds: clipOperations.map((item) => createdClipIdByEntityId.get(item.operation.targetEntityId)!), createdTrackIds };
}

async function replayMotionClipEntity(operation: Extract<MotionTemplateInstantiateOperation, { type: 'create-entity' }>, trackId: string): Promise<string> {
  const payload = operation.payload as Record<string, unknown>;
  const shape = payload.shape as MotionLayerDefinition['shape'];
  if (!shape || typeof shape !== 'object') throw new Error('Motion template clip payload is missing shape settings');
  const clipId = useTimelineStore.getState().addMotionShapeClip(trackId, operation.startTime, {
    primitive: shape.primitive,
    size: shape.size,
    duration: operation.duration,
    name: typeof payload.name === 'string' ? payload.name : 'Motion Shape',
  });
  if (!clipId) throw new Error('The editor could not create the motion template shape clip');
  useTimelineStore.getState().updateMotionLayer(clipId, (motion) => ({
    ...motion,
    shape: structuredClone(shape),
  }));
  replayReplicatorSettings(clipId, payload.replicator);
  // The native shape constructor creates a default fill. Remove it before the
  // ordered appearance-op entities are replayed.
  const defaultItems = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.appearance?.items ?? [];
  for (const item of defaultItems) {
    const removed = await handleUpdateMotionAppearances({ clipId, operations: [{ operation: 'remove', itemId: item.id }] }, useTimelineStore.getState());
    if (!removed.success) {
      throw new Error(removed.error ?? 'Motion template could not clear the default appearance');
    }
  }
  return clipId;
}

function replayReplicatorSettings(clipId: string, value: unknown): void {
  if (!isRecord(value)) return;
  let current = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.replicator ?? createDefaultReplicatorDefinition();
  const apply = (operation: Parameters<typeof planMotionReplicatorSemanticOperation>[1]) => {
    const planned = planMotionReplicatorSemanticOperation(current, operation);
    if (!planned.ok) throw new Error(planned.diagnostics[0]?.message ?? 'Motion replicator settings were rejected');
    current = planned.contract;
  };
  if (value.layout !== undefined) apply({ type: 'set-layout', expectedRevision: current.revision, layout: value.layout as never });
  if (value.terminalTransform !== undefined) apply({ type: 'set-terminal-transform', expectedRevision: current.revision, terminalTransform: value.terminalTransform as never });
  if (value.userLimit !== undefined) apply({ type: 'set-user-limit', expectedRevision: current.revision, userLimit: value.userLimit as number | null });
  if (value.enabled !== undefined) apply({ type: 'set-enabled', expectedRevision: current.revision, enabled: value.enabled as boolean });
  useTimelineStore.getState().updateMotionLayer(clipId, (motion) => ({ ...motion, replicator: current }));
}

async function replayModifierEntity(clipId: string, payload: unknown): Promise<void> {
  if (!isRecord(payload) || typeof payload.kind !== 'string' || !isRecord(payload.target)) {
    throw new Error('Motion template modifier payload is malformed');
  }
  const target = payload.target as Record<string, unknown>;
  const addArgs = {
    clipId,
    operation: 'add',
    kind: payload.kind,
    ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
    targetPath: target.path,
    targetOperation: target.operation,
    targetAmount: target.amount,
    ...(isRecord(payload.fields) ? payload.fields : {}),
  };
  // The current modifier domain allocator is revision-based. Advance a fresh
  // target stack through real handler add/remove operations before its first template
  // modifier so replay never reuses the source session's common `modifier-1-0`
  // identifier; the final stack still consists solely of replayed entities.
  if (!useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId)?.motion?.modifierStack) {
    const scratch = await handleEditMotionModifier(addArgs, useTimelineStore.getState());
    if (!scratch.success) throw new Error(scratch.error ?? 'Motion modifier namespace setup was rejected');
    const scratchId = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId)
      ?.motion?.modifierStack?.modifiers[0]?.id;
    if (!scratchId) throw new Error('Motion modifier namespace setup did not create a modifier');
    const removed = await handleEditMotionModifier({ clipId, operation: 'remove', modifierId: scratchId }, useTimelineStore.getState());
    if (!removed.success) throw new Error(removed.error ?? 'Motion modifier namespace setup could not remove its modifier');
  }
  const result = await handleEditMotionModifier(addArgs, useTimelineStore.getState());
  if (!result.success) throw new Error(result.error ?? 'Motion template modifier operation was rejected');
}

function replayKeyframesEntity(clipId: string, payload: unknown): void {
  if (!isRecord(payload) || !isRecord(payload.byPath)) throw new Error('Motion template keyframes payload is malformed');
  for (const [property, values] of Object.entries(payload.byPath)) {
    if (!Array.isArray(values)) throw new Error(`Motion template keyframes for ${property} must be an array`);
    for (const value of values) {
      if (!isRecord(value) || typeof value.time !== 'number' || typeof value.value !== 'number') {
        throw new Error(`Motion template keyframe for ${property} is malformed`);
      }
      useTimelineStore.getState().addKeyframe(
        clipId,
        property as never,
        value.value,
        value.time,
        typeof value.easing === 'string' ? value.easing : 'linear',
      );
    }
  }
}

function appearanceAddPayload(item: AppearanceItem): Record<string, unknown> {
  const common = { kind: item.kind, name: item.name, visible: item.visible, opacity: item.opacity, ...(item.blendMode ? { blendMode: item.blendMode } : {}) };
  if (item.kind === 'color-fill') return { ...common, color: motionColorToHex(item.color) };
  if (item.kind === 'stroke') return { ...common, color: motionColorToHex(item.color), width: item.width, alignment: item.alignment };
  if (item.kind === 'linear-gradient') return { ...common, stops: item.stops.map(({ offset, color }) => ({ offset, color: motionColorToHex(color) })), start: item.start, end: item.end };
  if (item.kind === 'radial-gradient') return { ...common, stops: item.stops.map(({ offset, color }) => ({ offset, color: motionColorToHex(color) })), center: item.center, radius: item.radius };
  return { ...common, ...(item.mediaFileId ? { mediaFileId: item.mediaFileId } : {}), fit: item.fit, transform: item.transform, ...(item.time !== undefined ? { time: item.time } : {}) };
}

// The appearance-op API accepts hex color strings; templates quantize colors
// to 8 bits per channel on capture (#RRGGBBAA round-trips via parseMotionColor).
function motionColorToHex(color: { r: number; g: number; b: number; a: number }): string {
  const channel = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${channel(color.a)}`;
}

function modifierAddPayload(modifier: NonNullable<MotionLayerDefinition['modifierStack']>['modifiers'][number]): Record<string, unknown> {
  const fields = modifier.kind === 'random' ? { seed: modifier.seed }
    : modifier.kind === 'noise' ? { seed: modifier.seed, indexFrequency: modifier.indexFrequency, timeFrequencyHz: modifier.timeFrequencyHz, octaves: modifier.octaves, lacunarity: modifier.lacunarity, persistence: modifier.persistence }
      : modifier.kind === 'oscillator' ? { waveform: modifier.waveform, frequencyHz: modifier.frequencyHz, cyclesAcrossInstances: modifier.cyclesAcrossInstances, phaseDegrees: modifier.phaseDegrees }
        : { field: modifier.field, centerX: modifier.center.x, centerY: modifier.center.y, radius: modifier.radius, exponent: modifier.exponent };
  return { kind: modifier.kind, enabled: modifier.enabled, target: modifier.targets[0], fields };
}

function resolveTemplateDependencies(envelope: MotionTemplateEnvelopeV1): Array<{ dependencyId: string; resolvedProjectId: string }> {
  const files = useMediaStore.getState().files;
  return envelope.dependencies.flatMap((dependency) => {
    if (dependency.kind !== 'media') return [];
    const file = files.find((candidate) => candidate.id === dependency.sourceProjectId)
      ?? files.find((candidate) => candidate.name === dependency.label);
    return file ? [{ dependencyId: dependency.id, resolvedProjectId: file.id }] : [];
  });
}

function materializeTemplateDependencyBindings(
  envelope: MotionTemplateEnvelopeV1,
  entries: readonly MotionTemplateDependencyInventoryEntry[],
): MotionTemplateEnvelopeV1 {
  const statusById = new Map(entries.map((entry) => [entry.dependencyId, entry]));
  const dependencyBySourceId = new Map(envelope.dependencies.map((dependency) => [dependency.sourceProjectId, dependency.id]));
  return {
    ...envelope,
    dependencies: envelope.dependencies.filter((dependency) => statusById.get(dependency.id)?.status === 'resolved'),
    entities: envelope.entities.map((entity) => {
      const payload = toTemplateJson(entity.payload) as Record<string, unknown>;
      if (entity.kind === 'appearance-op' && typeof payload.mediaFileId === 'string') {
        const dependencyId = dependencyBySourceId.get(payload.mediaFileId);
        const entry = dependencyId ? statusById.get(dependencyId) : undefined;
        if (entry?.status === 'resolved') payload.mediaFileId = entry.resolvedProjectId;
        else delete payload.mediaFileId;
      }
      return {
        ...entity,
        payload: payload as never,
        dependencyIds: entity.dependencyIds.filter((id) => statusById.get(id)?.status === 'resolved'),
      };
    }),
  };
}

function collectMotionRuntimeIds(state: TimelineStore): string[] {
  return [
    ...state.clips.map((clip) => clip.id),
    ...state.clips.flatMap((clip) => clip.motion?.appearance?.items.flatMap((item) => [item.id, ...(item.kind === 'linear-gradient' || item.kind === 'radial-gradient' ? item.stops.map((stop) => stop.id) : [])]) ?? []),
    ...state.clips.flatMap((clip) => clip.motion?.modifierStack?.modifiers.map((modifier) => modifier.id) ?? []),
    ...flattenTimelineKeyframes(state.clipKeyframes).map((keyframe) => keyframe.id),
  ];
}

function clipKeyframesFor(clipId: string): readonly Keyframe[] {
  return useTimelineStore.getState().clipKeyframes.get(clipId) ?? [];
}

function toTemplateJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function templateCreatedAt(templateId: string): number {
  const match = /_(\d+)_/.exec(templateId);
  return match ? Number(match[1]) : 0;
}

function countTemplateEntities(template: MotionTemplateEnvelopeV1): Record<string, number> {
  return template.entities.reduce<Record<string, number>>((counts, entity) => {
    counts[entity.kind] = (counts[entity.kind] ?? 0) + 1;
    return counts;
  }, {});
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
  } else if (kind === 'texture-fill') {
    item = createTextureFillAppearance();
  } else {
    throw new Error(
      `${fieldName}.kind must be one of: color-fill, stroke, linear-gradient, radial-gradient, texture-fill`,
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

  if (
    input.mediaFileId !== undefined
    || input.fit !== undefined
    || input.time !== undefined
    || input.transform !== undefined
  ) {
    if (next.kind !== 'texture-fill') {
      throw new Error(`${fieldName} texture fields require a texture-fill appearance`);
    }
    const mediaFileId = input.mediaFileId === undefined
      ? undefined
      : requiredNonEmptyString(input.mediaFileId, `${fieldName}.mediaFileId`);
    if (mediaFileId instanceof Error) throw mediaFileId;
    const fit = normalizeTextureFillFit(input.fit, `${fieldName}.fit`);
    const time = optionalFiniteNumber(input.time, `${fieldName}.time`, 0, Number.MAX_SAFE_INTEGER);
    const transform = normalizeTextureFillTransform(
      input.transform,
      `${fieldName}.transform`,
    );
    next = {
      ...next,
      ...(mediaFileId !== undefined ? { mediaFileId } : {}),
      ...(fit !== undefined ? { fit } : {}),
      ...(time !== undefined ? { time } : {}),
      ...(transform !== undefined ? { transform } : {}),
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

const TEXTURE_FILL_FIT_MODES: readonly TextureFillAppearance['fit'][] = [
  'contain',
  'cover',
  'fill',
  'stretch',
  'tile',
];

function normalizeTextureFillFit(
  value: unknown,
  fieldName: string,
): TextureFillAppearance['fit'] | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string'
    || !TEXTURE_FILL_FIT_MODES.includes(value as TextureFillAppearance['fit'])
  ) {
    throw new Error(`${fieldName} must be one of: ${TEXTURE_FILL_FIT_MODES.join(', ')}`);
  }
  return value as TextureFillAppearance['fit'];
}

function normalizeTextureFillTransform(
  value: unknown,
  fieldName: string,
): TextureFillAppearance['transform'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.scale)) {
    throw new Error(`${fieldName} must include position, scale, and rotation`);
  }
  return {
    position: {
      x: validateFiniteNumber(value.position.x, `${fieldName}.position.x`, -Number.MAX_VALUE, Number.MAX_VALUE),
      y: validateFiniteNumber(value.position.y, `${fieldName}.position.y`, -Number.MAX_VALUE, Number.MAX_VALUE),
    },
    scale: {
      x: validateFiniteNumber(value.scale.x, `${fieldName}.scale.x`, -Number.MAX_VALUE, Number.MAX_VALUE),
      y: validateFiniteNumber(value.scale.y, `${fieldName}.scale.y`, -Number.MAX_VALUE, Number.MAX_VALUE),
    },
    rotation: validateFiniteNumber(value.rotation, `${fieldName}.rotation`, -Number.MAX_VALUE, Number.MAX_VALUE),
  };
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
      if (
        item.mediaFileId !== undefined
        && (typeof item.mediaFileId !== 'string' || !item.mediaFileId.trim())
      ) {
        throw new Error(`${item.name}.mediaFileId must be a non-empty string`);
      }
      normalizeTextureFillFit(item.fit, `${item.name}.fit`);
      if (item.time !== undefined) {
        validateFiniteNumber(item.time, `${item.name}.time`, 0, Number.MAX_SAFE_INTEGER);
      }
      normalizeTextureFillTransform(item.transform, `${item.name}.transform`);
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

function flattenTimelineKeyframes(
  keyframes: TimelineStore['clipKeyframes'],
): Keyframe[] {
  return [...keyframes.values()].flat();
}

function describeMotionParentMutationEntities(input: {
  clipSnapshot: MutationEntitySnapshot<TimelineClip>;
  keyframeSnapshot: MutationEntitySnapshot<Keyframe>;
  clipsAfter: readonly TimelineClip[];
  keyframesAfter: TimelineStore['clipKeyframes'];
  updatedClipIds: readonly string[];
}) {
  const clipReceipt = describeMutationEntities(
    input.clipSnapshot,
    input.clipsAfter,
    { updatedEntityIds: input.updatedClipIds },
  );
  const keyframeReceipt = describeMutationEntities(
    input.keyframeSnapshot,
    flattenTimelineKeyframes(input.keyframesAfter),
    {
      updatedEntityIds: flattenTimelineKeyframes(input.keyframesAfter)
        .filter((keyframe) => input.updatedClipIds.includes(keyframe.clipId))
        .map((keyframe) => keyframe.id),
    },
  );
  return {
    stateRevisionBefore: Math.min(
      clipReceipt.stateRevisionBefore,
      keyframeReceipt.stateRevisionBefore,
    ),
    stateRevisionAfter: Math.max(
      clipReceipt.stateRevisionAfter,
      keyframeReceipt.stateRevisionAfter,
    ),
    entities: {
      created: [...clipReceipt.entities.created, ...keyframeReceipt.entities.created],
      updated: [...clipReceipt.entities.updated, ...keyframeReceipt.entities.updated],
      deleted: [...clipReceipt.entities.deleted, ...keyframeReceipt.entities.deleted],
    },
  };
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

export function handleSaveMotionTemplateForCurrentTimeline(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return handleSaveMotionTemplate(args, useTimelineStore.getState());
}

function validateMotionPathVertices(value: unknown): MotionPathVertex[] {
  if (!Array.isArray(value)) {
    throw new Error('vertices must be an array for path motion shapes');
  }
  if (value.length < 2 || value.length > MOTION_PATH_MAX_VERTICES) {
    throw new Error(`vertices must contain between 2 and ${MOTION_PATH_MAX_VERTICES} entries`);
  }
  const readVector = (input: unknown, fieldName: string) => {
    if (!isRecord(input)) throw new Error(`${fieldName} must be an object with finite x and y coordinates`);
    return {
      x: validateFiniteNumber(input.x, `${fieldName}.x`, -Number.MAX_VALUE, Number.MAX_VALUE),
      y: validateFiniteNumber(input.y, `${fieldName}.y`, -Number.MAX_VALUE, Number.MAX_VALUE),
    };
  };
  return value.map((input, index) => {
    if (!isRecord(input)) {
      throw new Error(`vertices[${index}] must be an object with finite x and y coordinates`);
    }
    return {
      x: validateFiniteNumber(input.x, `vertices[${index}].x`, -Number.MAX_VALUE, Number.MAX_VALUE),
      y: validateFiniteNumber(input.y, `vertices[${index}].y`, -Number.MAX_VALUE, Number.MAX_VALUE),
      handleIn: input.handleIn === undefined
        ? { x: 0, y: 0 }
        : readVector(input.handleIn, `vertices[${index}].handleIn`),
      handleOut: input.handleOut === undefined
        ? { x: 0, y: 0 }
        : readVector(input.handleOut, `vertices[${index}].handleOut`),
    };
  });
}

export function handleApplyMotionTemplateForCurrentTimeline(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return handleApplyMotionTemplate(args, useTimelineStore.getState());
}

export function handleSetMotionExpressionForCurrentTimeline(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return handleSetMotionExpression(args, useTimelineStore.getState());
}

function failure(error: string): ToolResult {
  return { success: false, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Motion Design error';
}

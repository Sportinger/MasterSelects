import {
  MOTION_PARENT_ERROR_CODES,
  MOTION_PARENT_GRAPH_BUDGETS,
  type MotionParentErrorCode,
  type MotionParentGraphEvaluation,
  type MotionParentGraphSnapshot,
  type MotionParentTransform2D,
} from './contracts';
import { evaluateMotionParentGraphWorldTransforms } from './parentGraphPlanner';
import {
  cloneMotionParentTransform2D,
  deriveMotionParentLocalTransform2D,
  isFiniteMotionParentTransform2D,
} from './parentTransformMath';
import { isValidMotionParentStableId } from './stableId';

export const MOTION_NULL_VIEWPORT_CONTROLLER_VERSION = 1 as const;

export const MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES = {
  INPUT_INVALID: 'MD6_NULL_VIEWPORT_INPUT_INVALID',
  NO_SELECTION: 'MD6_NULL_VIEWPORT_NO_SELECTION',
  CLIP_MISSING: 'MD6_NULL_VIEWPORT_CLIP_MISSING',
  NOT_MOTION_NULL: 'MD6_NULL_VIEWPORT_NOT_MOTION_NULL',
  THREE_D_UNSUPPORTED: 'MD6_NULL_VIEWPORT_3D_UNSUPPORTED',
  FRAME_TIME_MISMATCH: 'MD6_NULL_VIEWPORT_FRAME_TIME_MISMATCH',
  MAPPING_INVALID: 'MD6_NULL_VIEWPORT_MAPPING_INVALID',
  LOCKED: 'MD6_NULL_VIEWPORT_LOCKED',
  HIDDEN: 'MD6_NULL_VIEWPORT_HIDDEN',
  DRAG_BLOCKED: 'MD6_NULL_VIEWPORT_DRAG_BLOCKED',
  DRAG_DELTA_INVALID: 'MD6_NULL_VIEWPORT_DRAG_DELTA_INVALID',
} as const;

export type MotionNullViewportDiagnosticCode =
  | (typeof MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES)[keyof typeof MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES]
  | MotionParentErrorCode;

export interface MotionNullViewportDiagnostic {
  readonly code: MotionNullViewportDiagnosticCode;
  readonly severity: 'error' | 'notice';
  readonly blocking: boolean;
  readonly message: string;
  readonly clipIds: readonly string[];
}

/**
 * Store-independent metadata resolved by the integration seam. `hidden` and
 * `locked` normally mirror the owning track's effective state.
 */
export interface MotionNullViewportClipDescriptor {
  readonly clipId: string;
  readonly name: string;
  readonly sourceType: string | null;
  readonly locked: boolean;
  readonly hidden: boolean;
}

/**
 * `screenRect` is the displayed composition rectangle in the overlay's chosen
 * screen coordinate system, after fit, zoom, pan, and letterboxing.
 */
export interface MotionNullViewportMappingInput {
  readonly compositionSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly screenRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface MotionNullViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface MotionNullViewportControllerInput {
  readonly selectedClipId: string | null;
  readonly clips: readonly MotionNullViewportClipDescriptor[];
  readonly graph: MotionParentGraphSnapshot;
  /** Explicit-time local transforms for every graph node. */
  readonly evaluation: MotionParentGraphEvaluation;
  /** Must equal `evaluation.timelineTime`; no live playhead is consulted. */
  readonly timelineTime: number;
  readonly mapping: MotionNullViewportMappingInput;
}

export interface MotionNullViewportAccessibilityDescriptor {
  readonly id: string;
  readonly role: 'button';
  readonly tabIndex: 0 | -1;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
}

export interface MotionNullViewportGestureDescriptor {
  readonly pointer: {
    readonly action: 'translate-2d';
    readonly button: 0;
    readonly cursor: 'move';
    readonly pointerCapture: true;
    readonly axisConstraintModifier: 'Shift';
  };
  readonly keyboard: {
    readonly keys: readonly ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    readonly defaultStepScreenPixels: 10;
    readonly fineStepScreenPixels: 1;
    readonly coarseStepScreenPixels: 50;
    readonly fineModifier: 'ControlOrMeta';
    readonly coarseModifier: 'Alt';
  };
}

export interface MotionNullViewportControllerModel {
  readonly version: typeof MOTION_NULL_VIEWPORT_CONTROLLER_VERSION;
  readonly clipId: string;
  readonly name: string;
  readonly timelineTime: number;
  readonly parentClipId?: string;
  readonly mapping: MotionNullViewportMappingInput;
  /** Clip transform positions use the compositor's normalized half-extents. */
  readonly positionSpace: 'composition-half-extents';
  readonly localTransform: MotionParentTransform2D;
  readonly parentWorldTransform?: MotionParentTransform2D;
  readonly worldTransform: MotionParentTransform2D;
  readonly position: {
    readonly world: MotionNullViewportPoint;
    readonly composition: MotionNullViewportPoint;
    readonly screen: MotionNullViewportPoint;
    readonly insideComposition: boolean;
  };
  readonly handle: {
    readonly render: boolean;
    readonly interactive: boolean;
    readonly visual: 'motion-null-crosshair';
    readonly hitRadiusScreenPixels: 12;
    readonly geometry: {
      readonly center: MotionNullViewportPoint;
      readonly xAxis: {
        readonly from: MotionNullViewportPoint;
        readonly to: MotionNullViewportPoint;
      };
      readonly yAxis: {
        readonly from: MotionNullViewportPoint;
        readonly to: MotionNullViewportPoint;
      };
      readonly rotationDegrees: number;
    };
  };
  readonly accessibility: MotionNullViewportAccessibilityDescriptor;
  readonly gesture: MotionNullViewportGestureDescriptor;
}

export type MotionNullViewportControllerResult =
  | {
      readonly ok: true;
      readonly controller: MotionNullViewportControllerModel;
      readonly diagnostics: readonly MotionNullViewportDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly controller: null;
      readonly diagnostics: readonly MotionNullViewportDiagnostic[];
    };

export type MotionNullViewportDragAxis = 'free' | 'x' | 'y';

export interface PlanMotionNullViewportDragInput {
  readonly controller: MotionNullViewportControllerModel;
  readonly screenDelta: MotionNullViewportPoint;
  readonly axis?: MotionNullViewportDragAxis;
}

export interface MotionNullViewportPositionValueIntent {
  readonly property: 'position.x' | 'position.y';
  readonly fromValue: number;
  readonly toValue: number;
}

export interface MotionNullViewportDragIntent {
  readonly version: typeof MOTION_NULL_VIEWPORT_CONTROLLER_VERSION;
  readonly kind: 'move-motion-null-at-time';
  readonly clipId: string;
  readonly timelineTime: number;
  readonly parentClipId?: string;
  readonly targetSpace: 'clip-local';
  readonly positionSpace: 'composition-half-extents';
  readonly delta: {
    readonly screen: MotionNullViewportPoint;
    readonly composition: MotionNullViewportPoint;
    readonly world: MotionNullViewportPoint;
    readonly local: MotionNullViewportPoint;
  };
  readonly from: {
    readonly local: MotionNullViewportPoint;
    readonly world: MotionNullViewportPoint;
    readonly composition: MotionNullViewportPoint;
    readonly screen: MotionNullViewportPoint;
  };
  readonly to: {
    readonly local: MotionNullViewportPoint;
    readonly world: MotionNullViewportPoint;
    readonly composition: MotionNullViewportPoint;
    readonly screen: MotionNullViewportPoint;
  };
  /** Main decides whether these exact-time values update base data or keyframes. */
  readonly propertyValues: readonly [
    MotionNullViewportPositionValueIntent,
    MotionNullViewportPositionValueIntent,
  ];
  readonly localTransformPatch: {
    readonly position: MotionNullViewportPoint;
  };
  readonly previewWorldTransform: MotionParentTransform2D;
  readonly history: {
    readonly mode: 'single-entry';
    readonly label: 'Move Motion Null';
    readonly atomic: true;
  };
}

export type MotionNullViewportDragResult =
  | {
      readonly ok: true;
      readonly intent: MotionNullViewportDragIntent;
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      readonly intent: null;
      readonly diagnostics: readonly MotionNullViewportDiagnostic[];
    };

function diagnostic(
  code: MotionNullViewportDiagnosticCode,
  message: string,
  clipIds: readonly string[],
  severity: MotionNullViewportDiagnostic['severity'] = 'error',
): MotionNullViewportDiagnostic {
  return {
    code,
    severity,
    blocking: true,
    message,
    clipIds: [...new Set(clipIds)].sort(),
  };
}

function fail(
  code: MotionNullViewportDiagnosticCode,
  message: string,
  clipIds: readonly string[] = [],
): MotionNullViewportControllerResult {
  return {
    ok: false,
    controller: null,
    diagnostics: [diagnostic(code, message, clipIds)],
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFinitePoint(value: unknown): value is MotionNullViewportPoint {
  return isPlainRecord(value)
    && typeof value.x === 'number'
    && Number.isFinite(value.x)
    && typeof value.y === 'number'
    && Number.isFinite(value.y);
}

function isValidMapping(value: unknown): value is MotionNullViewportMappingInput {
  if (!isPlainRecord(value)) return false;
  const compositionSize = value.compositionSize;
  const screenRect = value.screenRect;
  if (!isPlainRecord(compositionSize) || !isPlainRecord(screenRect)) return false;
  return (
    typeof compositionSize.width === 'number'
    && Number.isFinite(compositionSize.width)
    && compositionSize.width > 0
    && typeof compositionSize.height === 'number'
    && Number.isFinite(compositionSize.height)
    && compositionSize.height > 0
    && typeof screenRect.x === 'number'
    && Number.isFinite(screenRect.x)
    && typeof screenRect.y === 'number'
    && Number.isFinite(screenRect.y)
    && typeof screenRect.width === 'number'
    && Number.isFinite(screenRect.width)
    && screenRect.width > 0
    && typeof screenRect.height === 'number'
    && Number.isFinite(screenRect.height)
    && screenRect.height > 0
  );
}

type ClipInspection =
  | { readonly ok: true; readonly clipsById: ReadonlyMap<string, MotionNullViewportClipDescriptor> }
  | { readonly ok: false };

function inspectClipDescriptors(value: unknown): ClipInspection {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > MOTION_PARENT_GRAPH_BUDGETS.maxNodes
  ) {
    return { ok: false };
  }

  const clipsById = new Map<string, MotionNullViewportClipDescriptor>();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return { ok: false };
    const candidate = value[index] as unknown;
    if (!isPlainRecord(candidate)) return { ok: false };
    const keys = Object.keys(candidate).sort();
    if (keys.join('\u0000') !== ['clipId', 'hidden', 'locked', 'name', 'sourceType'].join('\u0000')) {
      return { ok: false };
    }
    if (
      !isValidMotionParentStableId(candidate.clipId)
      || typeof candidate.name !== 'string'
      || candidate.name.length > 1_024
      || (typeof candidate.sourceType !== 'string' && candidate.sourceType !== null)
      || typeof candidate.locked !== 'boolean'
      || typeof candidate.hidden !== 'boolean'
      || clipsById.has(candidate.clipId)
    ) {
      return { ok: false };
    }
    clipsById.set(candidate.clipId, {
      clipId: candidate.clipId,
      name: candidate.name,
      sourceType: candidate.sourceType,
      locked: candidate.locked,
      hidden: candidate.hidden,
    });
  }
  return { ok: true, clipsById };
}

function cloneMapping(mapping: MotionNullViewportMappingInput): MotionNullViewportMappingInput {
  return {
    compositionSize: { ...mapping.compositionSize },
    screenRect: { ...mapping.screenRect },
  };
}

function worldToComposition(
  point: MotionNullViewportPoint,
  mapping: MotionNullViewportMappingInput,
): MotionNullViewportPoint {
  return {
    x: (0.5 + point.x * 0.5) * mapping.compositionSize.width,
    y: (0.5 + point.y * 0.5) * mapping.compositionSize.height,
  };
}

function compositionToScreen(
  point: MotionNullViewportPoint,
  mapping: MotionNullViewportMappingInput,
): MotionNullViewportPoint {
  return {
    x: mapping.screenRect.x
      + (point.x / mapping.compositionSize.width) * mapping.screenRect.width,
    y: mapping.screenRect.y
      + (point.y / mapping.compositionSize.height) * mapping.screenRect.height,
  };
}

function stableHandleId(clipId: string): string {
  return `motion-null-viewport-${encodeURIComponent(clipId)}`;
}

function buildHandleGeometry(
  center: MotionNullViewportPoint,
  rotationDegrees: number,
): MotionNullViewportControllerModel['handle']['geometry'] {
  const radians = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const armLength = 10;
  const xOffset = { x: cosine * armLength, y: sine * armLength };
  const yOffset = { x: -sine * armLength, y: cosine * armLength };
  return {
    center: { ...center },
    xAxis: {
      from: { x: center.x - xOffset.x, y: center.y - xOffset.y },
      to: { x: center.x + xOffset.x, y: center.y + xOffset.y },
    },
    yAxis: {
      from: { x: center.x - yOffset.x, y: center.y - yOffset.y },
      to: { x: center.x + yOffset.x, y: center.y + yOffset.y },
    },
    rotationDegrees,
  };
}

function buildGestureDescriptor(): MotionNullViewportGestureDescriptor {
  return {
    pointer: {
      action: 'translate-2d',
      button: 0,
      cursor: 'move',
      pointerCapture: true,
      axisConstraintModifier: 'Shift',
    },
    keyboard: {
      keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
      defaultStepScreenPixels: 10,
      fineStepScreenPixels: 1,
      coarseStepScreenPixels: 50,
      fineModifier: 'ControlOrMeta',
      coarseModifier: 'Alt',
    },
  };
}

/** Builds a serializable viewport handle model from one explicit frame only. */
export function buildMotionNullViewportController(
  input: MotionNullViewportControllerInput,
): MotionNullViewportControllerResult {
  if (!isValidMotionParentStableId(input.selectedClipId)) {
    return fail(
      input.selectedClipId === null
        ? MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.NO_SELECTION
        : MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.INPUT_INVALID,
      input.selectedClipId === null
        ? 'A selected Motion Null is required for a viewport handle.'
        : 'The selected clip id is invalid.',
    );
  }
  if (!Number.isFinite(input.timelineTime)) {
    return fail(
      MOTION_PARENT_ERROR_CODES.INVALID_TIMELINE_TIME,
      'The viewport controller requires an explicit finite timeline time.',
      [input.selectedClipId],
    );
  }
  if (!isValidMapping(input.mapping)) {
    return fail(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.MAPPING_INVALID,
      'Composition and displayed-screen mapping dimensions must be finite and positive.',
      [input.selectedClipId],
    );
  }

  const clipInspection = inspectClipDescriptors(input.clips);
  if (!clipInspection.ok) {
    return fail(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.INPUT_INVALID,
      'Viewport clip descriptors must be unique, bounded, inert data records.',
      [input.selectedClipId],
    );
  }
  const clip = clipInspection.clipsById.get(input.selectedClipId);
  if (!clip) {
    return fail(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.CLIP_MISSING,
      'The selected clip is missing from the viewport descriptor snapshot.',
      [input.selectedClipId],
    );
  }
  if (clip.sourceType !== 'motion-null') {
    return fail(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.NOT_MOTION_NULL,
      'Only a Motion Null can produce this viewport controller.',
      [clip.clipId],
    );
  }
  if (!input.evaluation || input.evaluation.timelineTime !== input.timelineTime) {
    return fail(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.FRAME_TIME_MISMATCH,
      'The parent transform snapshot does not match the requested viewport frame time.',
      [clip.clipId],
    );
  }

  const worldEvaluation = evaluateMotionParentGraphWorldTransforms(input.graph, input.evaluation);
  if (!worldEvaluation.worlds) {
    return {
      ok: false,
      controller: null,
      diagnostics: worldEvaluation.failures.map((failure) => diagnostic(
        failure.code,
        failure.message,
        failure.clipIds,
      )),
    };
  }

  const graphNode = input.graph.nodes.find((node) => node.clipId === clip.clipId);
  const localEntry = input.evaluation.localTransforms.find((entry) => entry.clipId === clip.clipId);
  const worldTransform = worldEvaluation.worlds.get(clip.clipId);
  if (!graphNode || !localEntry || !worldTransform) {
    return fail(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.CLIP_MISSING,
      'The selected Motion Null is missing from the exact-frame parent snapshot.',
      [clip.clipId],
    );
  }
  if (graphNode.space !== '2d') {
    return fail(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.THREE_D_UNSUPPORTED,
      'Motion Design 1.0 viewport Null handles support 2D transforms only.',
      [clip.clipId],
    );
  }

  const parentWorldTransform = graphNode.parentClipId
    ? worldEvaluation.worlds.get(graphNode.parentClipId)
    : undefined;
  if (graphNode.parentClipId && !parentWorldTransform) {
    return fail(
      MOTION_PARENT_ERROR_CODES.PARENT_MISSING,
      'The selected Motion Null parent is missing from the world-transform evaluation.',
      [clip.clipId, graphNode.parentClipId],
    );
  }

  const mapping = cloneMapping(input.mapping);
  const composition = worldToComposition(worldTransform.position, mapping);
  const screen = compositionToScreen(composition, mapping);
  const diagnostics: MotionNullViewportDiagnostic[] = [];
  if (clip.locked) {
    diagnostics.push(diagnostic(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.LOCKED,
      'The selected Motion Null is locked and cannot be moved.',
      [clip.clipId],
      'notice',
    ));
  }
  if (clip.hidden) {
    diagnostics.push(diagnostic(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.HIDDEN,
      'The selected Motion Null is hidden and has no viewport handle.',
      [clip.clipId],
      'notice',
    ));
  }

  const render = !clip.hidden;
  const interactive = render && !clip.locked;
  const accessibleName = clip.name.trim() || 'Motion Null';
  const description = clip.hidden
    ? 'This Motion Null is hidden and has no viewport handle.'
    : clip.locked
      ? 'This Motion Null is locked and cannot be moved.'
      : 'Drag to move in two dimensions. Use the arrow keys to nudge.';

  return {
    ok: true,
    diagnostics,
    controller: {
      version: MOTION_NULL_VIEWPORT_CONTROLLER_VERSION,
      clipId: clip.clipId,
      name: clip.name,
      timelineTime: input.timelineTime,
      ...(graphNode.parentClipId ? { parentClipId: graphNode.parentClipId } : {}),
      mapping,
      positionSpace: 'composition-half-extents',
      localTransform: cloneMotionParentTransform2D(localEntry.transform),
      ...(parentWorldTransform
        ? { parentWorldTransform: cloneMotionParentTransform2D(parentWorldTransform) }
        : {}),
      worldTransform: cloneMotionParentTransform2D(worldTransform),
      position: {
        world: { ...worldTransform.position },
        composition,
        screen,
        insideComposition: composition.x >= 0
          && composition.x <= mapping.compositionSize.width
          && composition.y >= 0
          && composition.y <= mapping.compositionSize.height,
      },
      handle: {
        render,
        interactive,
        visual: 'motion-null-crosshair',
        hitRadiusScreenPixels: 12,
        geometry: buildHandleGeometry(screen, worldTransform.rotationZ),
      },
      accessibility: {
        id: stableHandleId(clip.clipId),
        role: 'button',
        tabIndex: interactive ? 0 : -1,
        label: `Move ${accessibleName}`,
        description,
        disabled: !interactive,
      },
      gesture: buildGestureDescriptor(),
    },
  };
}

function dragFailure(
  code: MotionNullViewportDiagnosticCode,
  message: string,
  clipIds: readonly string[],
): MotionNullViewportDragResult {
  return {
    ok: false,
    intent: null,
    diagnostics: [diagnostic(code, message, clipIds)],
  };
}

/** Converts a screen-space drag into an exact-time clip-local transform intent. */
export function planMotionNullViewportDrag(
  input: PlanMotionNullViewportDragInput,
): MotionNullViewportDragResult {
  const controller = input.controller;
  if (
    !controller
    || controller.version !== MOTION_NULL_VIEWPORT_CONTROLLER_VERSION
    || !isValidMotionParentStableId(controller.clipId)
    || !Number.isFinite(controller.timelineTime)
    || !isValidMapping(controller.mapping)
    || !isFiniteMotionParentTransform2D(controller.localTransform)
    || !isFiniteMotionParentTransform2D(controller.worldTransform)
    || (controller.parentWorldTransform !== undefined
      && !isFiniteMotionParentTransform2D(controller.parentWorldTransform))
    || Boolean(controller.parentClipId) !== Boolean(controller.parentWorldTransform)
  ) {
    return dragFailure(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.INPUT_INVALID,
      'The viewport controller is invalid; no drag intent was emitted.',
      controller && isValidMotionParentStableId(controller.clipId) ? [controller.clipId] : [],
    );
  }
  if (!controller.handle.render) {
    return dragFailure(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.HIDDEN,
      'A hidden Motion Null cannot be dragged in the viewport.',
      [controller.clipId],
    );
  }
  if (!controller.handle.interactive) {
    return dragFailure(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.LOCKED,
      'A locked Motion Null cannot be dragged in the viewport.',
      [controller.clipId],
    );
  }
  if (!isFinitePoint(input.screenDelta)) {
    return dragFailure(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.DRAG_DELTA_INVALID,
      'A viewport drag requires a finite screen-space delta.',
      [controller.clipId],
    );
  }
  const axis = input.axis ?? 'free';
  if (axis !== 'free' && axis !== 'x' && axis !== 'y') {
    return dragFailure(
      MOTION_NULL_VIEWPORT_DIAGNOSTIC_CODES.DRAG_DELTA_INVALID,
      'The viewport drag axis constraint is invalid.',
      [controller.clipId],
    );
  }

  const screenDelta = {
    x: axis === 'y' ? 0 : input.screenDelta.x,
    y: axis === 'x' ? 0 : input.screenDelta.y,
  };
  const compositionDelta = {
    x: screenDelta.x
      * controller.mapping.compositionSize.width
      / controller.mapping.screenRect.width,
    y: screenDelta.y
      * controller.mapping.compositionSize.height
      / controller.mapping.screenRect.height,
  };
  const worldDelta = {
    x: compositionDelta.x * 2 / controller.mapping.compositionSize.width,
    y: compositionDelta.y * 2 / controller.mapping.compositionSize.height,
  };

  const inverseParentRadians = -(
    (controller.parentWorldTransform?.rotationZ ?? 0) * Math.PI / 180
  );
  const cosine = Math.cos(inverseParentRadians);
  const sine = Math.sin(inverseParentRadians);
  const localDelta = {
    x: worldDelta.x * cosine - worldDelta.y * sine,
    y: worldDelta.x * sine + worldDelta.y * cosine,
  };
  const nextWorld = {
    x: controller.worldTransform.position.x + worldDelta.x,
    y: controller.worldTransform.position.y + worldDelta.y,
  };
  const nextComposition = {
    x: controller.position.composition.x + compositionDelta.x,
    y: controller.position.composition.y + compositionDelta.y,
  };
  const nextScreen = {
    x: controller.position.screen.x + screenDelta.x,
    y: controller.position.screen.y + screenDelta.y,
  };
  const previewWorldTransform: MotionParentTransform2D = {
    ...cloneMotionParentTransform2D(controller.worldTransform),
    position: nextWorld,
  };
  if (
    !isFinitePoint(compositionDelta)
    || !isFinitePoint(worldDelta)
    || !isFinitePoint(nextWorld)
    || !isFinitePoint(nextComposition)
    || !isFinitePoint(nextScreen)
    || !isFiniteMotionParentTransform2D(previewWorldTransform)
  ) {
    return dragFailure(
      MOTION_PARENT_ERROR_CODES.NON_FINITE_TRANSFORM,
      'The viewport drag overflowed the finite transform range.',
      [controller.clipId, ...(controller.parentClipId ? [controller.parentClipId] : [])],
    );
  }

  const nextLocalTransform = controller.parentWorldTransform
    ? deriveMotionParentLocalTransform2D(
        controller.parentWorldTransform,
        previewWorldTransform,
        [controller.clipId, ...(controller.parentClipId ? [controller.parentClipId] : [])],
      )
    : { ok: true as const, transform: cloneMotionParentTransform2D(previewWorldTransform) };
  if (!nextLocalTransform.ok) {
    return dragFailure(
      nextLocalTransform.failure.code,
      nextLocalTransform.failure.message,
      nextLocalTransform.failure.clipIds,
    );
  }
  const nextLocal = { ...nextLocalTransform.transform.position };

  return {
    ok: true,
    diagnostics: [],
    intent: {
      version: MOTION_NULL_VIEWPORT_CONTROLLER_VERSION,
      kind: 'move-motion-null-at-time',
      clipId: controller.clipId,
      timelineTime: controller.timelineTime,
      ...(controller.parentClipId ? { parentClipId: controller.parentClipId } : {}),
      targetSpace: 'clip-local',
      positionSpace: 'composition-half-extents',
      delta: {
        screen: screenDelta,
        composition: compositionDelta,
        world: worldDelta,
        local: localDelta,
      },
      from: {
        local: { ...controller.localTransform.position },
        world: { ...controller.worldTransform.position },
        composition: { ...controller.position.composition },
        screen: { ...controller.position.screen },
      },
      to: {
        local: nextLocal,
        world: nextWorld,
        composition: nextComposition,
        screen: nextScreen,
      },
      propertyValues: [
        {
          property: 'position.x',
          fromValue: controller.localTransform.position.x,
          toValue: nextLocal.x,
        },
        {
          property: 'position.y',
          fromValue: controller.localTransform.position.y,
          toValue: nextLocal.y,
        },
      ],
      localTransformPatch: { position: nextLocal },
      previewWorldTransform,
      history: {
        mode: 'single-entry',
        label: 'Move Motion Null',
        atomic: true,
      },
    },
  };
}

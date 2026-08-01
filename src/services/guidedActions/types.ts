import type { CallerContext, ToolResult } from '../aiTools/types';
import type { PanelType } from '../../types/dock';
import type { TimelineToolGroupId, TimelineToolId } from '../../stores/timeline/types';

export type { CallerContext, ToolResult } from '../aiTools/types';

export type GuidedPlaybackMode =
  | 'aiReplay'
  | 'tutorialDemo'
  | 'guidedUser'
  | 'assist'
  | 'recordingReplay'
  | 'debug';

export type GuidedVisualizationMode = 'off' | 'concise' | 'full';
export type GuidedCompressionMode = 'none' | 'family' | 'aggressive';
export type GuidedLegacyFeedbackMode = 'off' | 'bridge' | 'native';
export type GuidedTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type GuidedMouseButton = 'left' | 'right' | 'middle';

export interface GuidedInputGesture {
  label: string;
  detail?: string;
  kind: 'mouse-left' | 'mouse-right' | 'mouse-middle' | 'keyboard' | 'shortcut';
}

export type SurfaceExecutionPolicy =
  | 'visualOnly'
  | 'transientUi'
  | 'persistUi'
  | 'semanticTool';

export interface GuidedAnimationBudget {
  totalMs: number;
  disabled: boolean;
  compression: GuidedCompressionMode;
}

export type GuidedTargetRef =
  | { kind: 'dom'; id: string }
  | { kind: 'panel'; panel: PanelType }
  | { kind: 'panelEdge'; groupId: string; edge: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'button'; id: string }
  | { kind: 'dropdown'; id: string }
  | { kind: 'dropdownOption'; dropdownId: string; value: string }
  | { kind: 'menuItem'; menuId: string; itemId: string }
  | { kind: 'propertiesTab'; tab: string }
  | { kind: 'propertyControl'; property: string; clipId?: string }
  | { kind: 'timelineClip'; clipId: string }
  | { kind: 'timelineTime'; surface?: 'track' | 'ruler'; trackId?: string; time: number }
  | { kind: 'timelineTrimHandle'; clipId: string; edge: 'start' | 'end' }
  | { kind: 'timelineFadeHandle'; clipId: string; edge: 'start' | 'end' }
  | { kind: 'timelineMarker'; markerId: string }
  | { kind: 'timelineKeyframe'; clipId: string; keyframeId: string }
  | { kind: 'previewPoint'; x: number; y: number }
  | { kind: 'previewPathVertex'; x: number; y: number; index: number }
  | { kind: 'maskToolbarButton'; button: 'pen' | 'rectangle' | 'ellipse' | 'edit' }
  | { kind: 'maskVertex'; maskId: string; vertexId?: string; index?: number }
  | { kind: 'maskHandle'; maskId: string; vertexId?: string; index?: number; handle: 'in' | 'out' }
  | { kind: 'maskEdge'; maskId: string; fromIndex: number; toIndex: number }
  | { kind: 'mediaItem'; itemId: string };

export type GuidedTargetKind = GuidedTargetRef['kind'];

export type GuidedInputLockPolicy =
  | { mode: 'locked'; allowCancel: true }
  | { mode: 'passthrough' }
  | { mode: 'targetOnly'; targets: GuidedTargetRef[] };

export interface GuidedExecutionContext {
  sessionId: string;
  callerContext: CallerContext;
  playbackMode: GuidedPlaybackMode;
  visualizationMode: GuidedVisualizationMode;
  animationBudget: GuidedAnimationBudget;
  inputLock: GuidedInputLockPolicy;
  legacyFeedback: GuidedLegacyFeedbackMode;
  abortSignal: AbortSignal;
}

export type ValidationCheck =
  | { kind: 'targetResolved'; target: GuidedTargetRef }
  | { kind: 'clipSelected'; clipId?: string }
  | { kind: 'propertiesTabOpen'; tab: string }
  | { kind: 'playheadAtTime'; time: number; toleranceSeconds?: number }
  | {
      kind: 'clipTransformMatches';
      clipId: string;
      property: 'position.x' | 'position.y' | 'position.z' | 'scale.x' | 'scale.y' | 'scale.z' | 'rotation.x' | 'rotation.y' | 'rotation.z';
      value: number;
      valueSpace?: 'store' | 'toolPixels';
      tolerance?: number;
    }
  | { kind: 'maskExists'; clipId: string; maskId?: string; vertexCount?: number }
  | { kind: 'activeMask'; clipId: string; maskId: string }
  | { kind: 'effectExists'; clipId: string; effectId?: string; effectType?: string }
  | { kind: 'keyframeExists'; clipId: string; keyframeId?: string; property?: string; time?: number }
  | { kind: 'mediaItemImported'; itemId?: string; name?: string }
  | { kind: 'custom'; id: string; label?: string; data?: Record<string, unknown> };

export type GuidedActionFamily =
  | 'inspect'
  | 'selection-navigation'
  | 'timeline-edit'
  | 'property-edit'
  | 'creation'
  | 'mask-edit'
  | 'keyframes'
  | 'media'
  | 'playback-debug'
  | 'context'
  | 'surface'
  | 'semantic'
  | 'validation'
  | 'feedback';

export interface GuidedActionBase {
  id?: string;
  family?: GuidedActionFamily;
  label?: string;
  optional?: boolean;
}

export interface GuidedMaskPathVertexInput {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  handleMode?: 'none' | 'mirrored' | 'split';
}

export interface GuidedMaskCreateOptions {
  enabled?: boolean;
  feather?: number;
  inverted?: boolean;
  mode?: 'add' | 'subtract' | 'intersect';
  name?: string;
  opacity?: number;
  visible?: boolean;
}

export type GuidedAction =
  | (GuidedActionBase & { type: 'delay'; ms: number })
  | (GuidedActionBase & { type: 'resolveTarget'; target: GuidedTargetRef; required?: boolean })
  | (GuidedActionBase & { type: 'moveCursorTo'; target: GuidedTargetRef; durationMs?: number })
  | (GuidedActionBase & { type: 'dragCursor'; from: GuidedTargetRef; to: GuidedTargetRef; durationMs?: number })
  | (GuidedActionBase & { type: 'clickVisual'; target?: GuidedTargetRef; button?: GuidedMouseButton; gestureLabel?: string; gestureDetail?: string })
  | (GuidedActionBase & { type: 'doubleClickVisual'; target?: GuidedTargetRef; button?: GuidedMouseButton; gestureLabel?: string; gestureDetail?: string })
  | (GuidedActionBase & { type: 'showInputGesture'; gesture: GuidedInputGesture })
  | (GuidedActionBase & { type: 'highlightTarget'; target: GuidedTargetRef; tone?: GuidedTone; durationMs?: number })
  | (GuidedActionBase & { type: 'spotlight'; target: GuidedTargetRef | null })
  | (GuidedActionBase & { type: 'callout'; title: string; body?: string; target?: GuidedTargetRef })
  | (GuidedActionBase & { type: 'scrollIntoView'; target: GuidedTargetRef; block?: 'start' | 'center' | 'end' | 'nearest' })
  | (GuidedActionBase & { type: 'focusPanel'; panel: PanelType })
  | (GuidedActionBase & { type: 'openTimelineToolGroupVisual'; groupId: TimelineToolGroupId; targetToolId?: TimelineToolId; target?: GuidedTargetRef; button?: GuidedMouseButton; gestureLabel?: string; gestureDetail?: string })
  | (GuidedActionBase & { type: 'resizePanel'; groupId: string; ratio: number; visualTarget?: GuidedTargetRef; policy?: SurfaceExecutionPolicy })
  | (GuidedActionBase & { type: 'openPropertiesTab'; tab: string })
  | (GuidedActionBase & { type: 'pressButton'; target: GuidedTargetRef; policy?: SurfaceExecutionPolicy })
  | (GuidedActionBase & { type: 'openDropdown'; target: GuidedTargetRef; policy?: SurfaceExecutionPolicy })
  | (GuidedActionBase & { type: 'chooseDropdownOption'; target: GuidedTargetRef; policy?: SurfaceExecutionPolicy })
  | (GuidedActionBase & { type: 'typeInto'; target: GuidedTargetRef; text: string; policy?: SurfaceExecutionPolicy })
  | (GuidedActionBase & { type: 'drawPreviewPath'; points: Array<{ x: number; y: number }>; close?: boolean; policy?: SurfaceExecutionPolicy })
  | (GuidedActionBase & { type: 'drawMaskPath'; clipId: string; vertices: GuidedMaskPathVertexInput[]; close?: boolean; mask?: GuidedMaskCreateOptions; policy?: SurfaceExecutionPolicy })
  | (GuidedActionBase & { type: 'selectClip'; clipId: string })
  | (GuidedActionBase & { type: 'setPlayheadVisual'; time: number })
  | (GuidedActionBase & { type: 'setTimelineToolVisual'; toolId: TimelineToolId })
  | (GuidedActionBase & { type: 'executeTool'; tool: string; args: Record<string, unknown> })
  | (GuidedActionBase & { type: 'confirmState'; check: ValidationCheck })
  | (GuidedActionBase & { type: 'waitForUserAction'; check: ValidationCheck; timeoutMs?: number })
  | (GuidedActionBase & { type: 'waitForTutorialNavigation' });

export type GuidedActionType = GuidedAction['type'];

export interface GuidedToolCall {
  id?: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface GuidedSessionRequest {
  actions: GuidedAction[];
  callerContext: CallerContext;
  playbackMode?: GuidedPlaybackMode;
  visualizationMode?: GuidedVisualizationMode;
  animationBudget?: Partial<GuidedAnimationBudget> | number;
  inputLock?: GuidedInputLockPolicy;
  legacyFeedback?: GuidedLegacyFeedbackMode;
  sessionId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export type GuidedSessionStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'skipped'
  | 'failed';

export interface GuidedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuidedPoint {
  x: number;
  y: number;
}

export type GuidedTargetMissingReason =
  | 'panel-hidden'
  | 'not-mounted'
  | 'offscreen'
  | 'entity-not-found'
  | 'unsupported-target-kind'
  | 'resolver-error';

export interface GuidedTargetResolved {
  status: 'resolved';
  target: GuidedTargetRef;
  rect?: GuidedRect;
  point?: GuidedPoint;
  center: GuidedPoint;
  element?: Element;
}

export interface GuidedTargetMissing {
  status: 'missing';
  target: GuidedTargetRef;
  reason: GuidedTargetMissingReason;
  message?: string;
  suggestedAction?: GuidedAction;
}

export type GuidedTargetResolution = GuidedTargetResolved | GuidedTargetMissing;
export type GuidedSerializableTargetResolution = Omit<GuidedTargetResolved, 'element'> | GuidedTargetMissing;

export interface GuidedTargetResolverContext {
  sessionId?: string;
  signal?: AbortSignal;
  nowMs?: number;
}

export type GuidedTargetResolver = (
  target: GuidedTargetRef,
  context: GuidedTargetResolverContext,
) => GuidedTargetResolution | Promise<GuidedTargetResolution | null> | null;

export interface GuidedScheduledAction {
  action: GuidedAction;
  index: number;
  family: GuidedActionFamily;
  startsAtMs: number;
  naturalDurationMs: number;
  compressedDurationMs: number;
  plannedDurationMs: number;
  compressed: boolean;
}

export interface GuidedCompressedGroup {
  family: GuidedActionFamily;
  startIndex: number;
  endIndex: number;
  actionCount: number;
  originalDurationMs: number;
  compressedDurationMs: number;
}

export interface GuidedScheduleDiagnostics {
  actionCount: number;
  requestedBudgetMs: number;
  normalizedBudgetMs: number;
  disabled: boolean;
  naturalDurationMs: number;
  compressedNaturalDurationMs: number;
  plannedDurationMs: number;
  scale: number;
  droppedOptionalSteps: number;
  compressedGroups: GuidedCompressedGroup[];
}

export interface GuidedSessionPlan {
  actions: GuidedScheduledAction[];
  diagnostics: GuidedScheduleDiagnostics;
}

export interface GuidedSessionSnapshot {
  id: string;
  status: GuidedSessionStatus;
  label?: string;
  context: Omit<GuidedExecutionContext, 'abortSignal'>;
  metadata?: Record<string, unknown>;
  startedAt: number;
  finishedAt?: number;
  plan: GuidedSessionPlan;
  error?: string;
}

export interface GuidedSessionResult {
  sessionId: string;
  status: Exclude<GuidedSessionStatus, 'idle' | 'running' | 'cancelling'>;
  diagnostics: GuidedScheduleDiagnostics;
  executedActions: number;
  skippedActions: number;
  toolResults: ToolResult[];
  error?: string;
}

export type GuidedRuntimeEvent =
  | { type: 'session-started'; sessionId: string }
  | { type: 'step-started'; sessionId: string; action: GuidedScheduledAction }
  | { type: 'step-completed'; sessionId: string; action: GuidedScheduledAction }
  | { type: 'target-resolved'; sessionId: string; resolution: GuidedSerializableTargetResolution }
  | { type: 'diagnostic'; sessionId: string; message: string; data?: Record<string, unknown> }
  | { type: 'session-finished'; sessionId: string; status: GuidedSessionResult['status'] };

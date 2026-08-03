// AI Tool Policy Registry
// Classifies every tool by risk level, read-only status, and caller permissions

import type {
  CallerContext,
  ToolAccessOptions,
  ToolPolicyEntry,
} from './types';
import { isKernelEditorToolName } from '../editorToolCatalog';

const allCallers: CallerContext[] = ['chat', 'devBridge', 'console', 'internal'];
const localFileCallers: CallerContext[] = ['chat', 'devBridge', 'console', 'internal'];
const bridgeTelemetryCallers: CallerContext[] = ['chat', 'devBridge', 'console', 'internal'];
const helperEditingCallers: CallerContext[] = ['chat', 'devBridge', 'console', 'internal'];

const PLAN_MODE_MUTATION_ALLOWLIST = new Set([
  'executeBatch',
  'createStoryboardPlan',
  'addStoryboardScene',
  'updateStoryboardScene',
  'attachStoryboardEvidence',
  'detachStoryboardEvidence',
  'setStoryboardCoverage',
  'createGenerationBriefRevision',
  'prepareStoryboardGeneration',
  'selectStoryboardCandidate',
  'createStoryboardFromTemplate',
  'resolveStoryboardDecision',
  'createTimelineVariantSet',
  'addTimelineVariantOption',
  'archiveTimelineVariantSet',
]);
const PLAN_MODE_MUTATION_DENYLIST = new Set([
  // These were historically tagged read-only for confirmation UX, but they
  // restore prior snapshots and therefore mutate real timeline/media state.
  'undo',
  'redo',
]);

// Helper to build policy entries
function readOnly(riskLevel: 'low' | 'medium' = 'low'): ToolPolicyEntry {
  return {
    readOnly: true,
    riskLevel,
    requiresConfirmation: false,
    sensitiveDataAccess: false,
    localFileAccess: false,
    allowedCallers: allCallers,
  };
}

function bridgeTelemetry(): ToolPolicyEntry {
  return {
    readOnly: true,
    riskLevel: 'low',
    requiresConfirmation: false,
    sensitiveDataAccess: true,
    localFileAccess: false,
    allowedCallers: bridgeTelemetryCallers,
  };
}

function mutatingLow(): ToolPolicyEntry {
  return {
    readOnly: false,
    riskLevel: 'low',
    requiresConfirmation: false,
    sensitiveDataAccess: false,
    localFileAccess: false,
    allowedCallers: helperEditingCallers,
  };
}

function mutatingMedium(): ToolPolicyEntry {
  return {
    readOnly: false,
    riskLevel: 'medium',
    requiresConfirmation: false,
    sensitiveDataAccess: false,
    localFileAccess: false,
    allowedCallers: helperEditingCallers,
  };
}

function mutatingHigh(): ToolPolicyEntry {
  return {
    readOnly: false,
    riskLevel: 'high',
    requiresConfirmation: true,
    sensitiveDataAccess: false,
    localFileAccess: false,
    allowedCallers: helperEditingCallers,
  };
}

function allowKernelOperation(policy: ToolPolicyEntry): ToolPolicyEntry {
  return {
    ...policy,
    allowedCallers: [...policy.allowedCallers, 'kernel'],
  };
}

function localFileAccess(): ToolPolicyEntry {
  return {
    readOnly: false,
    riskLevel: 'high',
    requiresConfirmation: true,
    sensitiveDataAccess: false,
    localFileAccess: true,
    allowedCallers: localFileCallers,
  };
}

function devBridgeFixture(): ToolPolicyEntry {
  return {
    readOnly: false,
    riskLevel: 'medium',
    requiresConfirmation: false,
    sensitiveDataAccess: true,
    localFileAccess: true,
    allowedCallers: ['devBridge', 'console', 'internal'],
  };
}

const TOOL_POLICY_MAP = new Map<string, ToolPolicyEntry>([
  // ── READ-ONLY (low risk) ──────────────────────────────────────────────
  ['getTimelineState', allowKernelOperation(readOnly())],
  ['getTimelineRangeSelection', readOnly()],
  ['verifyTimelineInvariants', {
    ...readOnly(),
    allowedCallers: ['chat', 'devBridge'],
  }],
  ['getClipDetails', readOnly()],
  ['getClipsInTimeRange', readOnly()],
  ['getMediaItems', readOnly()],
  ['getTimelineAnalysis', readOnly()],
  ['getClipAnalysis', readOnly()],
  ['getClipFaceAnalysis', readOnly()],
  ['getClipTranscript', readOnly()],
  ['getSpeechMarkers', readOnly()],
  ['findSilentSections', readOnly()],
  ['findLowQualitySections', readOnly()],
  ['getKeyframes', readOnly()],
  ['getTextProperties', readOnly()],
  ['getCaptionProperties', readOnly()],
  ['getMotionCapabilities', readOnly()],
  ['getMotionDesign', readOnly()],
  ['listMotionAppearancePresets', readOnly()],
  ['getMarkers', readOnly()],
  ['getMasks', readOnly()],
  ['listEffects', readOnly()],
  ['getYouTubeVideos', readOnly()],
  ['captureFrame', readOnly()],
  ['getCutPreviewQuad', readOnly()],
  ['getFramesAtTimes', allowKernelOperation(readOnly())],
  ['runPixelParticleDisintegrateQa', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runMotionDesignMd0Evidence', {
    readOnly: false,
    riskLevel: 'medium',
    requiresConfirmation: false,
    sensitiveDataAccess: true,
    localFileAccess: false,
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['selectClips', readOnly()],
  ['clearSelection', readOnly()],
  ['selectMediaItems', readOnly()],
  ['play', readOnly()],
  ['pause', readOnly()],
  ['simulateFrameKeypresses', readOnly()],
  ['simulateScrub', readOnly()],
  ['simulatePlayback', readOnly()],
  ['simulatePlaybackPulses', readOnly()],
  ['simulatePlaybackPath', readOnly()],
  ['monitorManualPause', bridgeTelemetry()],
  ['undo', readOnly()],
  ['redo', readOnly()],
  ['setPlayhead', readOnly()],
  ['setInOutPoints', readOnly()],
  ['openComposition', mutatingLow()],
  ['listStoryboardScenes', readOnly()],
  ['listTimelineVariantOptions', readOnly()],
  ['listMotionTemplates', readOnly()],

  // ── SENSITIVE (read-only but debug data) ──────────────────────────────
  ['getStats', bridgeTelemetry()],
  ['getCaptureState', bridgeTelemetry()],
  ['getAudioDiagnostics', bridgeTelemetry()],
  ['getStatsHistory', bridgeTelemetry()],
  ['getLogs', bridgeTelemetry()],
  ['getRuntimeDiagnostics', bridgeTelemetry()],
  ['getDockLayoutDebugState', bridgeTelemetry()],
  ['switchDockLayout', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'low',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['clearRuntimeDiagnostics', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'low',
  }],
  ['getPlaybackTrace', bridgeTelemetry()],
  ['samplePlaybackFramePacing', bridgeTelemetry()],
  ['purgePlaybackPath', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'low',
    allowedCallers: ['chat', 'devBridge', 'console', 'internal'],
  }],
  ['runWorkerFirstRenderCapabilityProbe', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'low',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstSolidTextImageGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstMultiVideoGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstWebCodecsProviderGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstWebCodecsProviderShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstHtmlProviderGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstHtmlProviderShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstJpegProxyGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstMultiTargetOutputSliceGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstRamCacheGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstBakeGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstExportGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstUniversal3dGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstW5EvidenceSuite', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstPlatformEvidencePackage', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['verifyWorkerFirstPlatformEvidenceMatrix', {
    ...bridgeTelemetry(),
    readOnly: true,
    riskLevel: 'low',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstRuntimeExportPlaybackSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstRealVideoRuntimeSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstEffectsMasksTransitionsGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstEffectsMasksTransitionsShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstNestedCompsGoldenFixture', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstMultiVideoShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstSolidTextImageShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstMultiTargetOutputSliceShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstJpegProxyShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstNestedCompsShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstRamCacheShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstBakeShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstExportShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstUniversal3dShadowParity', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['captureWorkerFirstGoldenFixtureFingerprint', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['captureWorkerFirstVisiblePresentationProof', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'low',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['runWorkerFirstVisiblePresentationStressProof', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'internal'],
  }],
  ['reloadApp', bridgeTelemetry()],
  ['setRenderHostMode', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'low',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['debugExport', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['createStressTestProjectFixture', devBridgeFixture()],
  ['runTimelineCanvasBladeToolSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runTimelineCanvasExportPreviewParitySmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runTimelineCanvasLargeProjectSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runTimelineCanvasMarqueeSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runTimelineCanvasPlayheadSmoothnessSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runTimelineCanvasThumbnailReloadSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runTimelineCanvasRamPreviewSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['runTimelineCanvasSpectralPlaybackSmoke', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'medium',
    allowedCallers: ['devBridge', 'console', 'internal'],
  }],
  ['getNodeWorkspaceDebugState', {
    ...bridgeTelemetry(),
  }],

  // ── LOCAL FILE ACCESS ─────────────────────────────────────────────────
  ['listLocalFiles', { ...localFileAccess(), readOnly: true }],
  ['importLocalFiles', localFileAccess()],

  // ── MUTATING HIGH RISK ────────────────────────────────────────────────
  ['deleteClip', mutatingHigh()],
  ['deleteClips', allowKernelOperation(mutatingHigh())],
  ['deleteTrack', mutatingHigh()],
  ['deleteMediaItem', mutatingHigh()],
  ['cutRangesFromClip', mutatingHigh()],
  ['executeBatch', mutatingHigh()],
  ['downloadAndImportVideo', mutatingHigh()],

  // ── MUTATING MEDIUM ───────────────────────────────────────────────────
  ['splitClip', mutatingMedium()],
  ['splitClipEvenly', mutatingMedium()],
  ['splitClipAtTimes', allowKernelOperation(mutatingMedium())],
  ['moveClip', mutatingMedium()],
  ['trimClip', mutatingMedium()],
  ['reorderClips', allowKernelOperation(mutatingMedium())],
  ['setTransform', mutatingMedium()],
  ['addEffect', mutatingMedium()],
  ['removeEffect', mutatingMedium()],
  ['updateEffect', mutatingMedium()],
  ['addKeyframe', mutatingMedium()],
  ['removeKeyframe', mutatingMedium()],
  ['createTextClip', mutatingMedium()],
  ['createCaptionClip', mutatingMedium()],
  ['createEditableTitleStack', mutatingMedium()],
  ['manageEditableHook', allowKernelOperation(mutatingMedium())],
  ['refineEditableHook', allowKernelOperation(mutatingMedium())],
  ['executeKernelEditorTool', allowKernelOperation(mutatingMedium())],
  ['updateTextProperties', mutatingMedium()],
  ['updateCaptionProperties', mutatingMedium()],
  ['setTextBox', mutatingMedium()],
  ['addTextBoundsKeyframe', mutatingMedium()],
  ['createMotionShapeClip', mutatingMedium()],
  ['updateMotionProperties', mutatingMedium()],
  ['updateMotionAppearances', mutatingMedium()],
  ['saveMotionAppearancePreset', mutatingMedium()],
  ['applyMotionAppearancePreset', mutatingMedium()],
  ['saveMotionTemplate', mutatingMedium()],
  ['applyMotionTemplate', mutatingMedium()],
  ['setMotionParent', mutatingMedium()],
  ['createMotionNull', mutatingMedium()],
  ['createMotionNullAndParent', mutatingMedium()],
  ['editMotionAdjustment', mutatingMedium()],
  ['configureMotionReplicator', mutatingMedium()],
  ['editMotionModifier', mutatingMedium()],
  ['setMotionExpression', mutatingMedium()],
  ['setClipSpeed', mutatingMedium()],
  ['addTransition', mutatingMedium()],
  ['removeTransition', mutatingMedium()],
  ['addMask', mutatingMedium()],
  ['addRectangleMask', mutatingMedium()],
  ['addEllipseMask', mutatingMedium()],
  ['removeMask', mutatingMedium()],
  ['updateMask', mutatingMedium()],
  ['addMaskPathKeyframe', mutatingMedium()],
  ['addVertex', mutatingMedium()],
  ['removeVertex', mutatingMedium()],
  ['updateVertex', mutatingMedium()],
  ['addStoryboardScene', mutatingMedium()],
  ['updateStoryboardScene', mutatingMedium()],
  ['createTimelineVariantSet', mutatingMedium()],
  ['addTimelineVariantOption', mutatingMedium()],
  ['materializeTimelineVariantOption', mutatingMedium()],
  ['commitTimelineVariantOption', mutatingMedium()],
  ['archiveTimelineVariantSet', mutatingMedium()],
  ['addClipSegment', mutatingMedium()],
  ['sendAINodePrompt', {
    ...mutatingMedium(),
    sensitiveDataAccess: true,
  }],

  // ── MUTATING LOW ──────────────────────────────────────────────────────
  ['createTrack', mutatingLow()],
  ['setTrackVisibility', mutatingLow()],
  ['setTrackMuted', mutatingLow()],
  ['createMediaFolder', mutatingLow()],
  ['renameMediaItem', mutatingLow()],
  ['moveMediaItems', mutatingLow()],
  ['createComposition', mutatingLow()],
  ['addMarker', mutatingLow()],
  ['removeMarker', mutatingLow()],
  ['startClipAnalysis', mutatingLow()],
  ['startClipFaceAnalysis', mutatingLow()],
  ['mergeClipFacePeople', mutatingLow()],
  ['moveClipFaceAppearance', mutatingLow()],
  ['assignClipFaceReviewCandidate', mutatingLow()],
  ['startClipTranscription', mutatingLow()],
  ['repairClipTranscript', mutatingLow()],
  ['startClipAudioIntelligence', mutatingLow()],
  ['searchYouTube', mutatingLow()],
  // searchVideos is the definition name for the same handler as searchYouTube
  ['searchVideos', mutatingLow()],
  ['listVideoFormats', mutatingLow()],

  // ── GAUSSIAN SPLAT DEBUG ────────────────────────────────────────────
]);

/**
 * Normalize a model-supplied tool name. Some providers (notably OpenAI tool
 * calling) prefix the function name with a `functions.` namespace, e.g.
 * `functions.addClipSegment`. Strip that prefix so policy lookup and dispatch
 * match the registered tool name instead of failing as "Unknown tool".
 */
export function normalizeToolName(toolName: string): string {
  return toolName.trim().replace(/^functions\./, '');
}

/**
 * Look up the policy entry for a tool.
 * Returns undefined for unknown tools (fail closed).
 */
export function getToolPolicy(toolName: string): ToolPolicyEntry | undefined {
  return TOOL_POLICY_MAP.get(normalizeToolName(toolName));
}

/** Return the names registered in the policy map for parity checks. */
export function getRegisteredToolPolicyNames(): string[] {
  return [...TOOL_POLICY_MAP.keys()];
}

/**
 * Check whether a caller is allowed to execute a given tool.
 * Unknown tools fail closed (not allowed).
 */
export function checkToolAccess(
  toolName: string,
  caller: CallerContext,
  options: ToolAccessOptions = {},
): { allowed: boolean; reason?: string } {
  const name = normalizeToolName(toolName);
  const policy = TOOL_POLICY_MAP.get(name);
  if (!policy) {
    return { allowed: false, reason: `Unknown tool: ${name}` };
  }
  const kernelEditorAccess = caller === 'kernel'
    && policy.allowedCallers.includes('chat')
    && isKernelEditorToolName(name);
  if (!policy.allowedCallers.includes(caller) && !kernelEditorAccess) {
    return { allowed: false, reason: `Tool "${name}" is not allowed for caller "${caller}"` };
  }
  if (
    options.executionMode === 'plan' &&
    PLAN_MODE_MUTATION_DENYLIST.has(name)
  ) {
    return {
      allowed: false,
      reason: `Tool "${name}" cannot restore real editor state while Plan mode is active.`,
    };
  }
  if (options.executionMode === 'read-only' && policy.readOnly !== true) {
    return {
      allowed: false,
      reason: `Tool "${name}" is mutating and this run is read-only.`,
    };
  }
  if (
    options.executionMode === 'plan'
    && policy.readOnly !== true
    && !PLAN_MODE_MUTATION_ALLOWLIST.has(name)
  ) {
    return {
      allowed: false,
      reason: `Tool "${name}" cannot change real media while Plan mode is active.`,
    };
  }
  return { allowed: true };
}

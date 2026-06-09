// AI Tool Policy Registry
// Classifies every tool by risk level, read-only status, and caller permissions

import type { ToolPolicyEntry, CallerContext } from './types';

const allCallers: CallerContext[] = ['chat', 'devBridge', 'nativeHelper', 'console', 'internal'];
const localFileCallers: CallerContext[] = ['chat', 'devBridge', 'nativeHelper', 'console', 'internal'];
const bridgeTelemetryCallers: CallerContext[] = ['chat', 'devBridge', 'console', 'internal'];
const helperEditingCallers: CallerContext[] = ['chat', 'devBridge', 'nativeHelper', 'console', 'internal'];

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
  ['getTimelineState', readOnly()],
  ['getClipDetails', readOnly()],
  ['getClipsInTimeRange', readOnly()],
  ['getMediaItems', readOnly()],
  ['getClipAnalysis', readOnly()],
  ['getClipTranscript', readOnly()],
  ['findSilentSections', readOnly()],
  ['findLowQualitySections', readOnly()],
  ['getKeyframes', readOnly()],
  ['getMarkers', readOnly()],
  ['getMasks', readOnly()],
  ['listEffects', readOnly()],
  ['getYouTubeVideos', readOnly()],
  ['captureFrame', readOnly()],
  ['getCutPreviewQuad', readOnly()],
  ['getFramesAtTimes', readOnly()],
  ['selectClips', readOnly()],
  ['clearSelection', readOnly()],
  ['selectMediaItems', readOnly()],
  ['play', readOnly()],
  ['pause', readOnly()],
  ['simulateScrub', readOnly()],
  ['simulatePlayback', readOnly()],
  ['simulatePlaybackPath', readOnly()],
  ['undo', readOnly()],
  ['redo', readOnly()],
  ['setPlayhead', readOnly()],
  ['setInOutPoints', readOnly()],
  ['openComposition', readOnly()],

  // ── SENSITIVE (read-only but debug data) ──────────────────────────────
  ['getStats', bridgeTelemetry()],
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
  ['purgePlaybackPath', {
    ...bridgeTelemetry(),
    readOnly: false,
    riskLevel: 'low',
    allowedCallers: ['chat', 'devBridge', 'console', 'internal'],
  }],
  ['reloadApp', bridgeTelemetry()],
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
  ['deleteClips', mutatingHigh()],
  ['deleteTrack', mutatingHigh()],
  ['deleteMediaItem', mutatingHigh()],
  ['cutRangesFromClip', mutatingHigh()],
  ['executeBatch', mutatingHigh()],
  ['downloadAndImportVideo', mutatingHigh()],

  // ── MUTATING MEDIUM ───────────────────────────────────────────────────
  ['splitClip', mutatingMedium()],
  ['splitClipEvenly', mutatingMedium()],
  ['splitClipAtTimes', mutatingMedium()],
  ['moveClip', mutatingMedium()],
  ['trimClip', mutatingMedium()],
  ['reorderClips', mutatingMedium()],
  ['setTransform', mutatingMedium()],
  ['addEffect', mutatingMedium()],
  ['removeEffect', mutatingMedium()],
  ['updateEffect', mutatingMedium()],
  ['addKeyframe', mutatingMedium()],
  ['removeKeyframe', mutatingMedium()],
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
  ['startClipTranscription', mutatingLow()],
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

/**
 * Check whether a caller is allowed to execute a given tool.
 * Unknown tools fail closed (not allowed).
 */
export function checkToolAccess(
  toolName: string,
  caller: CallerContext,
): { allowed: boolean; reason?: string } {
  const name = normalizeToolName(toolName);
  const policy = TOOL_POLICY_MAP.get(name);
  if (!policy) {
    return { allowed: false, reason: `Unknown tool: ${name}` };
  }
  if (!policy.allowedCallers.includes(caller)) {
    return { allowed: false, reason: `Tool "${name}" is not allowed for caller "${caller}"` };
  }
  return { allowed: true };
}

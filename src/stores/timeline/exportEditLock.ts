import type { TimelineStore } from './types';
import { Logger } from '../../services/logger';

const log = Logger.create('TimelineEditLock');

const EXPORT_LOCKED_ACTION_NAMES = new Set<string>([
  'addTrack',
  'removeTrack',
  'renameTrack',
  'setTrackMuted',
  'setTrackVisible',
  'setTrackSolo',
  'updateTrackAudioState',
  'setTrackAudioVolumeDb',
  'setTrackAudioPan',
  'addTrackAudioEffectInstance',
  'removeTrackAudioEffectInstance',
  'updateTrackAudioEffectInstance',
  'setTrackAudioEffectInstanceEnabled',
  'reorderTrackAudioEffectInstance',
  'updateMasterAudioState',
  'setMasterAudioVolumeDb',
  'setMasterLimiterEnabled',
  'setMasterTruePeakCeilingDb',
  'setMasterTargetLufs',
  'addMasterAudioEffectInstance',
  'removeMasterAudioEffectInstance',
  'updateMasterAudioEffectInstance',
  'setMasterAudioEffectInstanceEnabled',
  'reorderMasterAudioEffectInstance',
  'setTrackLocked',
  'setTrackHeight',
  'scaleTracksOfType',
  'setTrackParent',

  'addClip',
  'addCompClip',
  'updateClip',
  'removeClip',
  'moveClip',
  'trimClip',
  'splitClip',
  'splitClipAtPlayhead',
  'prepareTimelinePlacementRange',
  'updateClipTransform',
  'toggleClipReverse',
  'setClipParent',
  'setClipPreservesPitch',
  'applyAudioRegionEdit',
  'applyAudioRepairSuggestion',
  'applyDetectedSilenceRemoval',
  'applyRoomToneFill',
  'applyDetectedTransientSoftening',
  'pasteAudioRegionToSelection',
  'setClipAudioEditOperationRange',
  'setClipAudioEditOperationEnabled',
  'removeClipAudioEditOperation',
  'clearClipAudioEditStack',
  'bakeClipAudioEditStack',
  'unbakeClipAudioEditStack',
  'addCompositionVideoBakeRegion',
  'bakeCompositionVideoBakeRegion',
  'unbakeCompositionVideoBakeRegion',
  'removeCompositionVideoBakeRegion',
  'addClipVideoBakeRegion',
  'bakeClipVideoBakeRegion',
  'unbakeClipVideoBakeRegion',
  'removeClipVideoBakeRegion',
  'applySpectralRegionEdit',
  'addClipSpectralImageLayer',
  'updateClipSpectralImageLayer',
  'removeClipSpectralImageLayer',
  'startClipStemSeparation',
  'setClipStemSolo',
  'setClipStemEnabled',
  'setClipStemGain',
  'setClipSourceToStem',
  'clearClipStemSeparation',

  'addTextClip',
  'updateTextProperties',
  'updateTextBounds',
  'updateTextBoundsVertex',
  'updateTextBoundsVertices',
  'addSolidClip',
  'updateSolidColor',
  'addMathSceneClip',
  'updateMathScene',
  'addMathObject',
  'updateMathObject',
  'removeMathObject',
  'updateMathParameter',
  'addMotionShapeClip',
  'addMotionNullClip',
  'addMotionAdjustmentClip',
  'convertSolidToMotionShape',
  'updateMotionLayer',
  'addMeshClip',
  'updateText3DProperties',
  'addCameraClip',
  'addLightClip',
  'addSplatEffectorClip',

  'addClipEffect',
  'removeClipEffect',
  'updateClipEffect',
  'setClipEffectEnabled',
  'reorderClipEffect',
  'addClipAudioEffectInstance',
  'removeClipAudioEffectInstance',
  'updateClipAudioEffectInstance',
  'setClipAudioEffectInstanceEnabled',
  'reorderClipAudioEffectInstance',

  'ensureColorCorrection',
  'updateColorCorrection',
  'setColorCorrectionEnabled',
  'setColorViewMode',
  'setColorWorkspaceViewport',
  'selectColorNode',
  'addColorNode',
  'removeColorNode',
  'moveColorNode',
  'connectColorNodes',
  'removeColorEdge',
  'updateColorNodeParam',
  'setColorNodeEnabled',
  'renameColorNode',
  'resetColorNode',
  'resetColorCorrection',
  'duplicateColorVersion',
  'deleteColorVersion',
  'setActiveColorVersion',

  'createLinkedGroup',
  'unlinkGroup',
  'linkClips',
  'unlinkClips',
  'syncClipsViaAudio',
  'addPendingDownloadClip',
  'completeDownload',
  'setDownloadError',

  'addKeyframe',
  'addMaskPathKeyframe',
  'addTextBoundsPathKeyframe',
  'removeKeyframe',
  'updateKeyframe',
  'moveKeyframe',
  'moveKeyframes',
  'toggleKeyframeRecording',
  'setPropertyValue',
  'recordMaskPathKeyframe',
  'disableMaskPathKeyframes',
  'recordTextBoundsPathKeyframe',
  'disableTextBoundsPathKeyframes',
  'updateBezierHandle',

  'setMaskEditMode',
  'setMaskPanelActive',
  'setMaskDrawStart',
  'setActiveMask',
  'selectVertex',
  'selectVertices',
  'selectMaskEdge',
  'deselectAllVertices',
  'showMaskFeatherPreview',
  'addMask',
  'removeMask',
  'updateMask',
  'setMaskEdgeFeather',
  'reorderMasks',
  'addVertex',
  'removeVertex',
  'updateVertex',
  'updateVertices',
  'setVertexHandleMode',
  'closeMask',
  'addRectangleMask',
  'addEllipseMask',

  'addMarker',
  'removeMarker',
  'updateMarker',
  'moveMarker',
  'clearMarkers',

  'applyTransition',
  'removeTransition',
  'updateTransitionDuration',

  'addClipAICustomNode',
  'addClipAICustomNodeFromPort',
  'updateClipAICustomNode',
  'removeClipNodeGraphNode',
  'showClipNodeGraphBuiltIn',
  'connectClipNodeGraphPorts',
  'disconnectClipNodeGraphEdge',
  'moveClipNodeGraphNode',

  'pasteClips',
  'pasteKeyframes',
  'pasteClipEffects',
  'pasteClipColor',
  'pasteClipMask',

  'setPlayheadPosition',
  'setDraggingPlayhead',
  'play',
  'playForward',
  'playReverse',
  'setInPoint',
  'setOutPoint',
  'clearInOut',
  'setInPointAtPlayhead',
  'setOutPointAtPlayhead',
  'setLoopPlayback',
  'toggleLoopPlayback',
  'setPlaybackSpeed',
  'setDuration',

  'loadState',
  'clearTimeline',
]);

const ASYNC_NULL_ACTION_NAMES = new Set<string>(['addTextClip', 'bakeClipAudioEditStack', 'applyRoomToneFill', 'startClipStemSeparation']);
const ASYNC_ARRAY_ACTION_NAMES = new Set<string>(['applyDetectedSilenceRemoval', 'applyDetectedTransientSoftening']);
const ASYNC_FALSE_ACTION_NAMES = new Set<string>(['bakeCompositionVideoBakeRegion', 'bakeClipVideoBakeRegion']);
const ASYNC_VOID_ACTION_NAMES = new Set<string>(['addClip', 'addCompClip', 'completeDownload', 'loadState']);
const STRING_FALLBACK_ACTION_NAMES = new Set<string>([
  'addTrack',
  'addClipEffect',
  'addColorNode',
  'duplicateColorVersion',
  'addPendingDownloadClip',
  'addMarker',
  'addMask',
  'addVertex',
]);
const NULL_FALLBACK_ACTION_NAMES = new Set<string>([
  'addSolidClip',
  'addMathSceneClip',
  'addMotionShapeClip',
  'addMotionNullClip',
  'addMotionAdjustmentClip',
  'convertSolidToMotionShape',
  'addMeshClip',
  'addCameraClip',
  'addLightClip',
  'addSplatEffectorClip',
  'addClipAICustomNode',
  'addClipAICustomNodeFromPort',
  'applyAudioRegionEdit',
  'applyAudioRepairSuggestion',
  'pasteAudioRegionToSelection',
  'addClipAudioEffectInstance',
  'addTrackAudioEffectInstance',
  'addMasterAudioEffectInstance',
  'addCompositionVideoBakeRegion',
  'addClipVideoBakeRegion',
]);
const FALSE_FALLBACK_ACTION_NAMES = new Set<string>([
  'unbakeCompositionVideoBakeRegion',
  'removeCompositionVideoBakeRegion',
  'unbakeClipVideoBakeRegion',
  'removeClipVideoBakeRegion',
]);

function getLockedReturnValue(actionName: string): unknown {
  if (ASYNC_NULL_ACTION_NAMES.has(actionName)) return Promise.resolve(null);
  if (ASYNC_ARRAY_ACTION_NAMES.has(actionName)) return Promise.resolve([]);
  if (ASYNC_FALSE_ACTION_NAMES.has(actionName)) return Promise.resolve(false);
  if (ASYNC_VOID_ACTION_NAMES.has(actionName)) return Promise.resolve();
  if (STRING_FALLBACK_ACTION_NAMES.has(actionName)) return '';
  if (NULL_FALLBACK_ACTION_NAMES.has(actionName)) return null;
  if (FALSE_FALLBACK_ACTION_NAMES.has(actionName)) return false;
  return undefined;
}

export function lockTimelineEditActions<T extends object>(
  actions: T,
  get: () => Pick<TimelineStore, 'isExporting'>,
): T {
  const wrapped = { ...(actions as unknown as Record<string, unknown>) };

  for (const actionName of EXPORT_LOCKED_ACTION_NAMES) {
    const action = wrapped[actionName];
    if (typeof action !== 'function') continue;

    wrapped[actionName] = (...args: unknown[]) => {
      if (get().isExporting) {
        log.warn('Blocked timeline edit during export', { action: actionName });
        return getLockedReturnValue(actionName);
      }
      return (action as (...nextArgs: unknown[]) => unknown)(...args);
    };
  }

  return wrapped as T;
}

import type { TimelineActionBindings } from './useTimelineActionController';
import { useTimelinePlaybackSideEffectsController } from './useTimelinePlaybackSideEffectsController';

type PlaybackSideEffectsParams = Parameters<typeof useTimelinePlaybackSideEffectsController>[0];

type PlaybackActionKey =
  | 'addMarker'
  | 'applyTimelineEditOperation'
  | 'cancelRamPreview'
  | 'clearInOut'
  | 'copyClips'
  | 'copyKeyframes'
  | 'getInterpolatedEffects'
  | 'getInterpolatedSpeed'
  | 'getInterpolatedTransform'
  | 'getInterpolatedVectorAnimationSettings'
  | 'getSourceTimeForClip'
  | 'pasteClips'
  | 'pasteKeyframes'
  | 'pause'
  | 'play'
  | 'playForward'
  | 'playReverse'
  | 'setDraggingPlayhead'
  | 'setInPointAtPlayhead'
  | 'setOutPointAtPlayhead'
  | 'setPlayheadPosition'
  | 'setScrollX'
  | 'splitClipAtPlayhead'
  | 'startRamPreview'
  | 'toggleCutTool'
  | 'toggleLoopPlayback';

interface UseTimelinePlaybackControllerParams extends Omit<PlaybackSideEffectsParams, PlaybackActionKey> {
  timelineActions: Pick<TimelineActionBindings, PlaybackActionKey>;
}

export function useTimelinePlaybackController({
  timelineActions,
  ...params
}: UseTimelinePlaybackControllerParams): void {
  useTimelinePlaybackSideEffectsController({
    ...params,
    addMarker: timelineActions.addMarker,
    applyTimelineEditOperation: timelineActions.applyTimelineEditOperation,
    cancelRamPreview: timelineActions.cancelRamPreview,
    clearInOut: timelineActions.clearInOut,
    copyClips: timelineActions.copyClips,
    copyKeyframes: timelineActions.copyKeyframes,
    getInterpolatedEffects: timelineActions.getInterpolatedEffects,
    getInterpolatedSpeed: timelineActions.getInterpolatedSpeed,
    getInterpolatedTransform: timelineActions.getInterpolatedTransform,
    getInterpolatedVectorAnimationSettings: timelineActions.getInterpolatedVectorAnimationSettings,
    getSourceTimeForClip: timelineActions.getSourceTimeForClip,
    pasteClips: timelineActions.pasteClips,
    pasteKeyframes: timelineActions.pasteKeyframes,
    pause: timelineActions.pause,
    play: timelineActions.play,
    playForward: timelineActions.playForward,
    playReverse: timelineActions.playReverse,
    setDraggingPlayhead: timelineActions.setDraggingPlayhead,
    setInPointAtPlayhead: timelineActions.setInPointAtPlayhead,
    setOutPointAtPlayhead: timelineActions.setOutPointAtPlayhead,
    setPlayheadPosition: timelineActions.setPlayheadPosition,
    setScrollX: timelineActions.setScrollX,
    splitClipAtPlayhead: timelineActions.splitClipAtPlayhead,
    startRamPreview: timelineActions.startRamPreview,
    toggleCutTool: timelineActions.toggleCutTool,
    toggleLoopPlayback: timelineActions.toggleLoopPlayback,
  });
}

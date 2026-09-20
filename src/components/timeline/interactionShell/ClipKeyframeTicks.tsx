import { useCallback } from 'react';
import { ClipKeyframeTicks as ClipKeyframeTickList } from '../components/ClipKeyframeTicks';
import { useClipKeyframeTickDrag } from '../hooks/useClipKeyframeTickDrag';
import { retimeKeyframesForEdgeTrim } from '../../../utils/keyframeTrimAnchoring';
import { computeTrimTiming } from '../utils/clipTrimTiming';
import { getClipShellKeyframeGroups } from '../utils/timelineTrackInteractionShellState';
import type { ClipInteractionShellCommandContext, ClipInteractionShellCommands } from './types';
import { isClipKeyframeBypassed } from '../../../services/nodeGraph/keyframePlaybackState';
import { useTimelineStore } from '../../../stores/timeline';

interface ClipKeyframeTicksProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

const formatShellKeyframeTime = (seconds: number): string => `${seconds.toFixed(2)}s`;

export function ClipKeyframeTicks({ context, commands }: ClipKeyframeTicksProps) {
  const ownerClip = useTimelineStore(state => state.clips.find(clip => clip.id === context.clip.id));
  const keyframe = context.activeModules.keyframe;
  const trim = context.activeModules.trim?.state;
  const trimTiming = trim?.clipId === context.clip.id
    ? computeTrimTiming(context.clip, trim.edge, {
        startTime: trim.originalStartTime,
        duration: trim.originalDuration,
        inPoint: trim.originalInPoint,
        outPoint: trim.originalOutPoint,
      }, trim.appliedDelta)
    : null;
  const displayDuration = Math.max(0.001, trimTiming?.newDuration ?? context.clip.duration);
  const previewKeyframes = trimTiming && trim
    ? retimeKeyframesForEdgeTrim(
        keyframe?.keyframes ?? [],
        {
          startTime: trim.originalStartTime,
          duration: trim.originalDuration,
          inPoint: trim.originalInPoint,
          outPoint: trim.originalOutPoint,
        },
        {
          startTime: trimTiming.newStartTime,
          duration: trimTiming.newDuration,
          inPoint: trimTiming.newInPoint,
          outPoint: trimTiming.newOutPoint,
        },
      )
    : null;
  const keyframeGroups = previewKeyframes
    ? getClipShellKeyframeGroups(previewKeyframes)
    : keyframe?.keyframeGroups ?? [];

  const onBeginKeyframeGroupMove = useCallback((keyframeIds: string[], startTime: number) => {
    commands?.onMoveKeyframeGroup?.(keyframeIds, startTime, context, 'begin');
  }, [commands, context]);

  const onMoveKeyframeGroup = useCallback((keyframeIds: string[], newTime: number) => {
    commands?.onMoveKeyframeGroup?.(keyframeIds, newTime, context, 'update');
  }, [commands, context]);

  const onCommitKeyframeGroupMove = useCallback((keyframeIds: string[], newTime: number) => {
    commands?.onMoveKeyframeGroup?.(keyframeIds, newTime, context, 'commit');
  }, [commands, context]);

  const {
    keyframeGroupDrag,
    handleKeyframeTickMouseDown,
  } = useClipKeyframeTickDrag({
    keyframeTickGroups: keyframeGroups,
    displayDuration,
    width: context.geometry.clip.width,
    onMoveKeyframeGroup,
    onKeyframeGroupDragBegin: onBeginKeyframeGroupMove,
    onKeyframeGroupDragCommit: onCommitKeyframeGroupMove,
  });

  if (!keyframe?.enabled) return null;

  return (
    <ClipKeyframeTickList
      groups={keyframeGroups}
      bypassedKeyframeIds={new Set((keyframe.keyframes ?? []).filter(kf => isClipKeyframeBypassed(ownerClip, kf)).map(kf => kf.id))}
      displayDuration={displayDuration}
      draggingKeyframeIds={keyframeGroupDrag?.keyframeIds}
      isTrackLocked={context.track.locked === true}
      formatTime={formatShellKeyframeTime}
      onTickMouseDown={handleKeyframeTickMouseDown}
    />
  );
}

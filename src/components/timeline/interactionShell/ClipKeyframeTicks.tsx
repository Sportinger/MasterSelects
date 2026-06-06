import { useCallback } from 'react';
import { ClipKeyframeTicks as ClipKeyframeTickList } from '../components/ClipKeyframeTicks';
import { useClipKeyframeTickDrag } from '../hooks/useClipKeyframeTickDrag';
import type { ClipInteractionShellCommandContext, ClipInteractionShellCommands } from './types';

interface ClipKeyframeTicksProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

const formatShellKeyframeTime = (seconds: number): string => `${seconds.toFixed(2)}s`;

export function ClipKeyframeTicks({ context, commands }: ClipKeyframeTicksProps) {
  const keyframe = context.activeModules.keyframe;
  const displayDuration = Math.max(0.001, context.clip.duration);

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
    keyframeTickGroups: keyframe?.keyframeGroups ?? [],
    displayDuration,
    width: context.geometry.clip.width,
    onMoveKeyframeGroup,
    onKeyframeGroupDragBegin: onBeginKeyframeGroupMove,
    onKeyframeGroupDragCommit: onCommitKeyframeGroupMove,
  });

  if (!keyframe?.enabled) return null;

  return (
    <ClipKeyframeTickList
      groups={keyframe.keyframeGroups}
      displayDuration={displayDuration}
      draggingKeyframeIds={keyframeGroupDrag?.keyframeIds}
      isTrackLocked={context.track.locked === true}
      formatTime={formatShellKeyframeTime}
      onTickMouseDown={handleKeyframeTickMouseDown}
    />
  );
}

import { memo } from 'react';
import './ClipKeyframeTicks.css';

export interface ClipKeyframeTickGroupView {
  time: number;
  keyframeIds: string[];
  hasStateChange?: boolean;
}

interface ClipKeyframeTicksProps {
  groups: readonly ClipKeyframeTickGroupView[];
  displayDuration: number;
  draggingKeyframeIds?: readonly string[] | null;
  bypassedKeyframeIds?: ReadonlySet<string>;
  isTrackLocked: boolean;
  formatTime: (seconds: number) => string;
  onTickMouseDown: (e: React.MouseEvent<HTMLButtonElement>, group: ClipKeyframeTickGroupView) => void;
}

export const ClipKeyframeTicks = memo(function ClipKeyframeTicks({
  groups,
  displayDuration,
  draggingKeyframeIds,
  bypassedKeyframeIds,
  isTrackLocked,
  formatTime,
  onTickMouseDown,
}: ClipKeyframeTicksProps) {
  if (groups.length === 0) return null;

  return (
    <div className="clip-keyframe-ticks">
      {groups.map((group, i) => {
        const xPercent = (group.time / displayDuration) * 100;
        if (xPercent < 0 || xPercent > 100) return null;
        const isDraggingKeyframeGroup = draggingKeyframeIds
          ? group.keyframeIds.some(id => draggingKeyframeIds.includes(id))
          : false;
        const keyframeCount = group.keyframeIds.length || 1;
        const bypassedCount = group.keyframeIds.filter(id => bypassedKeyframeIds?.has(id)).length;
        const bypassed = bypassedCount === keyframeCount;
        const bypassTitle = bypassedCount ? ` · ${bypassedCount} transform keyframes bypassed` : '';

        return (
          <button
            type="button"
            key={`${group.time}:${group.keyframeIds.join('|') || i}`}
            className={`keyframe-tick${isDraggingKeyframeGroup ? ' dragging' : ''}${group.hasStateChange ? ' state-change' : ''}${bypassed ? ' bypassed' : ''}`}
            style={{ left: `${xPercent}%` }}
            onMouseDown={isTrackLocked ? undefined : (e) => onTickMouseDown(e, group)}
            onClick={(e) => e.stopPropagation()}
            onPointerUp={event => event.currentTarget.blur()}
            aria-label={`Move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)}${bypassTitle}`}
            title={`Drag to move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)} (Shift snaps to clip keyframes)${bypassTitle}`}
          />
        );
      })}
    </div>
  );
});

import { PickWhip } from '../PickWhip';
import { useTimelinePickWhipContext } from '../TimelinePickWhipContext';
import type { ClipInteractionShellCommandContext } from './types';

export function ClipParentingControls({ context }: { context: ClipInteractionShellCommandContext }) {
  const pickWhip = useTimelinePickWhipContext();
  const module = context.activeModules.parenting;
  if (!pickWhip || !module?.enabled) return null;

  const drag = pickWhip.drag;
  const isSource = drag?.sourceClipId === context.clip.id;
  const isTarget = drag?.targetClipId === context.clip.id;
  const targetStatus = isTarget ? drag.status : 'idle';

  return (
    <div
      className={`shell-parenting-module ${drag ? 'drag-active' : ''} ${isSource ? 'source' : ''} ${isTarget ? `target-${targetStatus}` : ''}`}
      data-clip-interaction-slot="parenting"
      data-parent-drop-status={isTarget ? targetStatus : undefined}
      title={isTarget ? drag.diagnostic : undefined}
    >
      <PickWhip
        clipId={context.clip.id}
        clipName={context.clip.name}
        parentClipId={module.parentClipId}
        parentClipName={module.parentClipName}
        isDragging={isSource}
        disabled={module.locked}
        diagnostic={module.locked ? 'Unlock the track before parenting.' : undefined}
        onSetParent={(clipId) => pickWhip.clearParent(clipId)}
        onDragStart={pickWhip.startDrag}
        onDragEnd={pickWhip.cancelDrag}
      />
    </div>
  );
}

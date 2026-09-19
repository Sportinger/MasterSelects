import { useState } from 'react';

import { endBatch, startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip } from '../../types/timeline';
import {
  resolveThreeDOriginCenter,
  supportsOriginToCenter,
} from '../../services/threeDOriginCenter';

interface ClipOriginContextMenuItemProps {
  clip: TimelineClip | null | undefined;
  canModify: boolean;
  onDone: () => void;
}

export function ClipOriginContextMenuItem({
  clip,
  canModify,
  onDone,
}: ClipOriginContextMenuItemProps) {
  const [centering, setCentering] = useState(false);
  if (!supportsOriginToCenter(clip)) return null;

  const centerOrigin = async () => {
    if (!clip || !canModify || centering) return;
    setCentering(true);
    try {
      const center = await resolveThreeDOriginCenter(clip);
      const { disablePropertyKeyframes } = useTimelineStore.getState();
      startBatch('Origin to center');
      try {
        disablePropertyKeyframes(clip.id, 'anchor.x', center.x);
        disablePropertyKeyframes(clip.id, 'anchor.y', center.y);
        disablePropertyKeyframes(clip.id, 'anchor.z', center.z);
        disablePropertyKeyframes(clip.id, 'position.x', 0);
        disablePropertyKeyframes(clip.id, 'position.y', 0);
        disablePropertyKeyframes(clip.id, 'position.z', 0);
      } finally {
        endBatch();
      }
      onDone();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Origin to Center failed: ${message}`);
      setCentering(false);
    }
  };

  return (
    <>
      <div className="context-menu-separator" />
      <div
        className={`context-menu-item ${!canModify || centering ? 'disabled' : ''}`}
        onClick={() => void centerOrigin()}
      >
        {centering ? 'Centering Origin…' : 'Origin to Center'}
      </div>
    </>
  );
}

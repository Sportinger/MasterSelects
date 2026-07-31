import { useCallback, useEffect, useRef, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { ClipInteractionShellGeometry } from '../interactionShell';
import type { StoryboardClipProperties } from '../../../types/storyboard';

type TimelineCanvasClipRenameInputProps = {
  clip: {
    id: string;
    name: string;
    source?: { type?: string | null } | null;
    storyboardProperties?: Pick<StoryboardClipProperties, 'sceneId'>;
  };
  geometry: ClipInteractionShellGeometry;
};

export function TimelineCanvasClipRenameInput({
  clip,
  geometry,
}: TimelineCanvasClipRenameInputProps) {
  const renameMidiClip = useTimelineStore((state) => state.renameMidiClip);
  const updateStoryboardScene = useTimelineStore((state) => state.updateStoryboardScene);
  const setClipRenameId = useTimelineStore((state) => state.setClipRenameId);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [value, setValue] = useState(clip.name);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const commit = useCallback(() => {
    if (cancelledRef.current) return;
    const nextName = value.trim();
    if (nextName && nextName !== clip.name) {
      if (clip.source?.type === 'storyboard' && clip.storyboardProperties) {
        updateStoryboardScene(
          clip.storyboardProperties.sceneId,
          { title: nextName },
          { historyLabel: 'Rename storyboard scene' },
        );
      } else {
        renameMidiClip(clip.id, nextName);
      }
    }
    setClipRenameId(null);
  }, [clip, renameMidiClip, setClipRenameId, updateStoryboardScene, value]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setClipRenameId(null);
  }, [setClipRenameId]);

  const visibleWidth = Math.max(0, geometry.visibleClip.width);
  const width = Math.max(
    24,
    Math.min(220, Math.max(0, visibleWidth - 12), Math.max(0, geometry.clip.width - 12)),
  );
  const height = Math.max(14, Math.min(20, geometry.clip.height - 8));

  return (
    <input
      ref={inputRef}
      className="timeline-canvas-clip-name-input"
      value={value}
      style={{
        left: geometry.visibleClip.x + 6,
        top: geometry.clip.y + 4,
        width,
        height,
      }}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={commit}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}

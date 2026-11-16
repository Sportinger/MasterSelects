import type { PointerEvent } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { setMediaDataLevels, supportsDataLevelsOverride } from '../../../services/mediaRuntime/mediaDataLevels';

const blurAfterPointer = (event: PointerEvent<HTMLElement>) => (event.currentTarget as HTMLElement).blur();

/**
 * Data levels of the clip's source file. "Full range" keeps camera superwhites (blown-out faces
 * under a spot) that video range clips to white; it applies to every clip of the file and the export.
 */
export function ColorDataLevelsToggle({ clipId }: { clipId: string }) {
  const mediaFileId = useTimelineStore(state => {
    const clip = state.clips.find(candidate => candidate.id === clipId);
    return clip?.source?.type === 'video' ? clip.source.mediaFileId ?? clip.mediaFileId : undefined;
  });
  const file = useMediaStore(state => mediaFileId ? state.files.find(candidate => candidate.id === mediaFileId) : undefined);
  if (!file || !supportsDataLevelsOverride(file)) return null;
  const full = file.dataLevels === 'full';
  const id = `properties-data-levels-${clipId}`;
  return (
    <div className="properties-color-node-picker properties-camera-grade" title="Decode the whole file as full range (0-255) so highlights above legal white keep their detail. Applies to every clip of this file and to the export; set black and white with the grade afterwards.">
      <label htmlFor={id}>Superwhites</label>
      <span className="properties-camera-grade-control">
        <input
          id={id}
          type="checkbox"
          checked={full}
          onPointerUp={blurAfterPointer}
          onChange={event => { setMediaDataLevels(file.id, event.currentTarget.checked ? 'full' : 'video'); }}
        />
        <span>{full ? 'Full range (whole file)' : 'Video range (clipped)'}</span>
      </span>
    </div>
  );
}

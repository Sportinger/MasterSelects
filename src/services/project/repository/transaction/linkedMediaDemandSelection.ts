import type { TimelineClip } from '../../../../types/timeline';
import type { Composition } from '../../../../stores/mediaStore/types';

/** Only sources used now (plus short playback lookahead), or all used sources during export. */
export function selectDemandedLinkedMedia(clips: readonly TimelineClip[], time: number, all = false,
  multicam?: Composition['multicam']): Set<string> {
  const ids = new Set<string>();
  const visit = (tree: readonly TimelineClip[], position: number) => {
    for (const clip of tree) {
      if (!all && (position + 2 < clip.startTime || position >= clip.startTime + clip.duration)) continue;
      const id = clip.source?.mediaFileId ?? clip.mediaFileId; if (id) ids.add(id);
      if (clip.nestedClips) visit(clip.nestedClips, (clip.inPoint ?? 0) + (position - clip.startTime) * (clip.speed ?? 1));
    }
  };
  visit(clips, time);
  if (multicam?.active) for (const angle of multicam.angles) for (const source of angle.sources) {
    if (all || (time + 2 >= source.startTime && time < source.startTime + source.duration)) ids.add(source.mediaFileId);
  }
  return ids;
}

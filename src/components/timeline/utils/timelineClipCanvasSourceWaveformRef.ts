import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { getPreferredWaveformPyramidRef } from '../../../utils/audioWaveformPresence';

function getClipMediaFileId(clip: TimelinePaintSourceClip): string | null {
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

// Map of media file id -> source waveform pyramid id, used to back-fill clips
// that are missing their own ref. The id may be recorded on the media file
// itself; collect it where present.
export function buildSourceWaveformPyramidIdMap(
  mediaFiles: readonly MediaFile[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const file of mediaFiles) {
    const pyramidId = file.audioAnalysisRefs?.waveformPyramidId;
    if (pyramidId) map.set(file.id, pyramidId);
  }
  return map;
}

// The waveform pyramid is content-addressed by the source (one pyramid per media
// file, shared by all its clips), but its reference is stored per clip and only
// back-filled onto the clip that triggered analysis (clipWaveformAnalysisActions).
// A clip created/rebuilt before the source finished analysing — and that never
// ran its own analysis because the source was already done — ends up with an
// empty sourceAnalysisRefs, so it falls back to a single-channel (mono) render
// while its siblings render the full stereo pyramid. Resolve that here: when a
// clip has no waveform pyramid ref of its own, borrow the shared source pyramid
// id from the media file or from any sibling clip of the same source. The id can
// live on the media file and/or only on the sibling clips, so collect from both.
// Non-destructive (render-time only); fixes existing and future clips regardless
// of how the per-clip ref went missing.
// See docs/Features/Timeline.md "Audio" -> waveform pyramid resolution.
export function enrichClipsWithSourceWaveformRef(
  clips: readonly TimelinePaintSourceClip[],
  sourcePyramidIdByMediaFileId: ReadonlyMap<string, string>,
): readonly TimelinePaintSourceClip[] {
  const pyramidIdByMediaFileId = new Map(sourcePyramidIdByMediaFileId);
  for (const clip of clips) {
    const mediaFileId = getClipMediaFileId(clip);
    if (!mediaFileId || pyramidIdByMediaFileId.has(mediaFileId)) continue;
    const ref = getPreferredWaveformPyramidRef(clip);
    if (ref) pyramidIdByMediaFileId.set(mediaFileId, ref);
  }
  if (pyramidIdByMediaFileId.size === 0) return clips;

  let changed = false;
  const next = clips.map((clip) => {
    if (getPreferredWaveformPyramidRef(clip)) return clip;
    const mediaFileId = getClipMediaFileId(clip);
    if (!mediaFileId) return clip;
    const pyramidId = pyramidIdByMediaFileId.get(mediaFileId);
    if (!pyramidId) return clip;
    changed = true;
    return {
      ...clip,
      audioState: {
        ...(clip.audioState ?? {}),
        sourceAnalysisRefs: {
          ...(clip.audioState?.sourceAnalysisRefs ?? {}),
          waveformPyramidId: pyramidId,
        },
      },
    };
  });
  return changed ? next : clips;
}

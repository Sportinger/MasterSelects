import type { MasterAudioState, TimelineClip, TimelineTrack } from '../../../types';
import { readAudioExportMediaFiles } from '../../../services/export/audioExportMediaStoreAdapter';
import { Logger } from '../../../services/logger';
import { getClipExportTailSeconds } from './rangePlanning';
import { renderAudioGraph } from '../AudioGraphRenderer';
const log = Logger.create('AudioExportSelection');

export function selectExportAudioClips(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  startTime: number,
  endTime: number,
  masterAudioState?: MasterAudioState
): TimelineClip[] {
  const mediaFiles = readAudioExportMediaFiles();

  const candidates = clips.filter(clip => {
    // Check if clip is in range
    const track = tracks.find(candidate => candidate.id === clip.trackId);
    const clipEnd = clip.startTime + clip.duration;
    const tailSeconds = getClipExportTailSeconds(clip, track, masterAudioState);
    if (clipEnd + tailSeconds <= startTime || clip.startTime >= endTime) {
      return false;
    }

    // Nested composition with mixdown audio
    if (clip.isComposition && clip.mixdownBuffer && clip.hasMixdownAudio) {
      return true;
    }

    // MIDI clips are rendered to audio by the track instrument (issue #182).
    // They carry only note data (a placeholder File), so check that explicitly
    // before the media-source check below would reject them.
    if (clip.source?.type === 'midi') {
      return (clip.midiData?.notes?.length ?? 0) > 0;
    }

    // Check if clip has audio source
    if (!clip.source?.audioElement && !clip.source?.videoElement && !clip.file) {
      return false;
    }

    // For video clips, we need the linked audio clip
    // For audio clips, we use them directly
    if (clip.source?.type === 'audio') {
      const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
      const mediaFile = mediaFileId ? mediaFiles.find(file => file.id === mediaFileId) : null;
      if (mediaFile?.hasAudio === false) {
        log.debug('Skipping audio clip for media marked without audio', {
          clip: clip.name,
          mediaFile: mediaFile.name,
        });
        return false;
      }

      return true;
    }

    // Video clips don't have audio in this architecture
    // (audio is in separate linked clips)
    return false;
  });

  if (candidates.length === 0) {
    return [];
  }

  const plan = renderAudioGraph({ clips: candidates, tracks, mode: 'export' });
  const activeTrackIds = new Set(plan.tracks.filter(track => track.active).map(track => track.trackId));
  const activeClipIds = new Set(
    plan.clips
      .filter(clip => clip.active && activeTrackIds.has(clip.trackId))
      .map(clip => clip.clipId)
  );

  return candidates.filter(clip => activeClipIds.has(clip.id));
}


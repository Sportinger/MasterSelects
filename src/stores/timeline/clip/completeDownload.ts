// YouTube download completion - extracted from completeDownload
// Handles converting pending download clips to actual video clips

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { initWebCodecsFullMode, createAudioElement } from '../helpers/webCodecsHelpers';
import { generateWaveformForFile } from '../helpers/waveformHelpers';
import { thumbnailCache } from '../../../services/thumbnailCache';
import { generateClipId } from '../helpers/idGenerator';
import { updateClipById } from '../helpers/clipStateHelpers';
import { Logger } from '../../../services/logger';

const log = Logger.create('CompleteDownload');

export interface CompleteDownloadParams {
  clipId: string;
  file: File;
  clips: TimelineClip[];
  waveformsEnabled: boolean;
  findAvailableAudioTrack: (startTime: number, duration: number) => string | null;
  updateDuration: () => void;
  invalidateCache: () => void;
  set: (state: any) => void;
  get: () => any;
}

/**
 * Complete a pending YouTube download - convert to actual video clip.
 */
export async function completeDownload(params: CompleteDownloadParams): Promise<void> {
  const {
    clipId,
    file,
    clips,
    waveformsEnabled,
    findAvailableAudioTrack,
    updateDuration,
    invalidateCache,
    set,
    get,
  } = params;

  const clip = clips.find(c => c.id === clipId);
  if (!clip?.isPendingDownload) {
    log.warn('Clip not found or not pending', { clipId });
    return;
  }

  log.debug('Completing download', { clipId });

  // WebCodecs Full Mode: load via WebCodecsPlayer
  const { player: webCodecsPlayer, audioPlayer } = await initWebCodecsFullMode(file);
  const naturalDuration = webCodecsPlayer.duration || 30;

  // Import to media store in YouTube folder
  const mediaStore = useMediaStore.getState();

  // Find or create YouTube folder
  let ytFolder = mediaStore.folders.find(f => f.name === 'YouTube' && f.parentId === null);
  if (!ytFolder) {
    ytFolder = mediaStore.createFolder('YouTube');
  }

  const mediaFile = await mediaStore.importFile(file, ytFolder.id);

  // Find/create audio track
  const audioTrackId = findAvailableAudioTrack(clip.startTime, naturalDuration);
  const audioClipId = audioTrackId ? generateClipId('clip-audio-yt') : undefined;

  // Update video clip
  const updatedClips = clips.map(c => {
    if (c.id !== clipId) return c;
    return {
      ...c,
      file,
      duration: naturalDuration,
      outPoint: naturalDuration,
      source: {
        type: 'video' as const,
        webCodecsPlayer,
        audioPlayer: audioPlayer ?? undefined,
        naturalDuration,
        mediaFileId: mediaFile.id,
      },
      mediaFileId: mediaFile.id,
      linkedClipId: audioClipId,
      isPendingDownload: false,
      downloadProgress: undefined,
      youtubeVideoId: undefined,
      youtubeThumbnail: undefined,
    };
  });

  // Create linked audio clip
  if (audioTrackId && audioClipId) {
    const audioClip: TimelineClip = {
      id: audioClipId,
      trackId: audioTrackId,
      name: `${clip.name} (Audio)`,
      file,
      startTime: clip.startTime,
      duration: naturalDuration,
      inPoint: 0,
      outPoint: naturalDuration,
      source: { type: 'audio', naturalDuration, mediaFileId: mediaFile.id },
      mediaFileId: mediaFile.id,
      linkedClipId: clipId,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };
    updatedClips.push(audioClip);
    log.debug('Created linked audio clip', { audioClipId });
  }

  set({ clips: updatedClips });
  updateDuration();
  invalidateCache();

  log.debug('Download complete', { clipId, duration: naturalDuration });

  // Load audio element for linked audio clip
  if (audioTrackId && audioClipId) {
    const audio = createAudioElement(file);

    set({
      clips: updateClipById(get().clips, audioClipId, {
        source: { type: 'audio' as const, audioElement: audio, naturalDuration, mediaFileId: mediaFile.id }
      }),
    });

    // Generate waveform in background
    if (waveformsEnabled) {
      generateWaveformAsync(audioClipId, file, get, set);
    }
  }

  // Preload on-demand thumbnail cache
  if (mediaFile.id) {
    thumbnailCache.preloadClip(mediaFile.id, naturalDuration, file);
  }
}

/**
 * Generate waveform asynchronously.
 */
async function generateWaveformAsync(
  audioClipId: string,
  file: File,
  get: () => any,
  set: (state: any) => void
): Promise<void> {
  set({ clips: updateClipById(get().clips, audioClipId, { waveformGenerating: true, waveformProgress: 0 }) });

  try {
    const waveform = await generateWaveformForFile(file);
    set({ clips: updateClipById(get().clips, audioClipId, { waveform, waveformGenerating: false }) });
    log.debug('Waveform generated for audio clip');
  } catch (e) {
    log.warn('Waveform generation failed', e);
    set({ clips: updateClipById(get().clips, audioClipId, { waveformGenerating: false }) });
  }
}


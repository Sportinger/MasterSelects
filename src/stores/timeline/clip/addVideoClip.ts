// Video clip addition - extracted from addClip
// Handles video file loading, WebCodecs initialization, thumbnails, and linked audio

import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { useSettingsStore } from '../../settingsStore';
import { NativeDecoder } from '../../../services/nativeHelper';
import { NativeHelperClient } from '../../../services/nativeHelper/NativeHelperClient';
import {
  createVideoElement,
  releaseTemporaryMediaElement,
  waitForVideoMetadata,
} from '../helpers/webCodecsHelpers';
import { shouldSkipWaveform } from '../helpers/waveformHelpers';
import { generateLinkedClipIds } from '../helpers/idGenerator';
import { detectVideoAudio } from '../helpers/audioDetection';
import { getMP4MetadataFast, estimateDurationFromFileSize } from '../helpers/mp4MetadataHelper';
import { Logger } from '../../../services/logger';
import { registerNativeDecoderForTimelineClip } from '../../../services/timeline/nativeDecoderRuntimeRegistry';
import { loadLinkedAudio } from './videoLinkedAudioLoader';
import { loadCachedProjectAnalysisForVideo } from './videoCachedAnalysisLoader';
import { startVideoThumbnailGeneration } from './videoThumbnailLoader';

const log = Logger.create('AddVideoClip');

type FileWithPath = File & { path?: string };

export interface AddVideoClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
  tracks: TimelineTrack[];
  findAvailableAudioTrack: (startTime: number, duration: number) => string | null;
}

export interface AddVideoClipResult {
  videoClip: TimelineClip;
  audioClip: TimelineClip | null;
  audioClipId: string | undefined;
}

/**
 * Create placeholder clips for video (and linked audio) immediately.
 * Returns clips ready to be added to state while media loads in background.
 */
export function createVideoClipPlaceholders(params: AddVideoClipParams): AddVideoClipResult {
  const { trackId, file, startTime, estimatedDuration, mediaFileId, findAvailableAudioTrack } = params;

  const { videoId: clipId, audioId } = generateLinkedClipIds();
  const audioTrackId = findAvailableAudioTrack(startTime, estimatedDuration);
  const audioClipId = audioTrackId ? audioId : undefined;

  const videoClip: TimelineClip = {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'video', naturalDuration: estimatedDuration, mediaFileId },
    linkedClipId: audioClipId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };

  let audioClip: TimelineClip | null = null;
  if (audioTrackId && audioClipId) {
    audioClip = {
      id: audioClipId,
      trackId: audioTrackId,
      name: `${file.name} (Audio)`,
      file,
      startTime,
      duration: estimatedDuration,
      inPoint: 0,
      outPoint: estimatedDuration,
      source: { type: 'audio', naturalDuration: estimatedDuration, mediaFileId },
      linkedClipId: clipId,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: true,
    };
  }

  return { videoClip, audioClip, audioClipId };
}

export interface LoadVideoMediaParams {
  clipId: string;
  audioClipId?: string;
  file: File;
  mediaFileId?: string;
  authoritativeNaturalDuration?: number;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  setClips: (updater: (clips: TimelineClip[]) => TimelineClip[]) => void;
}

/**
 * Load video media in background - handles Native Helper, WebCodecs, thumbnails, and audio.
 */
export async function loadVideoMedia(params: LoadVideoMediaParams): Promise<void> {
  const {
    clipId,
    audioClipId,
    file,
    mediaFileId,
    authoritativeNaturalDuration,
    thumbnailsEnabled,
    waveformsEnabled,
    updateClip,
    setClips,
  } = params;

  // Use native decoder when Turbo Mode is on and helper is connected
  // FFmpeg can decode all formats (H.264, ProRes, DNxHD, etc.) with HW acceleration
  const { nativeDecodeEnabled, nativeHelperConnected } = useSettingsStore.getState();
  const useNativeDecoder = nativeDecodeEnabled && nativeHelperConnected;

  let nativeDecoder: NativeDecoder | null = null;
  let video: HTMLVideoElement | null = null;
  let naturalDuration = 5; // default estimate

  // Try Native Helper for professional codecs (ProRes, DNxHD)
  if (useNativeDecoder) {
    try {
      const mediaFile = mediaFileId
        ? useMediaStore.getState().files.find(f => f.id === mediaFileId)
        : null;
      let filePath = mediaFile?.absolutePath || (file as FileWithPath).path;

      // Check if we have a valid absolute path (Unix: /... , Windows: C:\...)
      const isAbsolute = filePath && (filePath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(filePath));

      // If no absolute path, ask the native helper to locate the file
      if (!isAbsolute) {
        log.debug('No absolute path found, asking native helper to locate', { filename: file.name });
        const located = await NativeHelperClient.locateFile(file.name);
        if (located) {
          filePath = located;
          log.debug('Native helper located file', { filePath });
        } else {
          throw new Error(`Could not locate file "${file.name}" on disk. Try importing via File > Open.`);
        }
      }

      log.debug('Opening with Native Helper', { file: file.name });
      if (!filePath) {
        throw new Error(`Could not resolve file path for "${file.name}"`);
      }
      nativeDecoder = await NativeDecoder.open(filePath);
      naturalDuration = authoritativeNaturalDuration ?? nativeDecoder.duration;

      log.debug('Native Helper ready', { width: nativeDecoder.width, height: nativeDecoder.height, fps: nativeDecoder.fps });

      // Decode initial frame so preview isn't black
      await nativeDecoder.seekToFrame(0);

      const registered = registerNativeDecoderForTimelineClip({
        clipId,
        mediaFileId,
        filePath,
        decoder: nativeDecoder,
      });
      if (!registered) {
        await nativeDecoder.close().catch(() => undefined);
        throw new Error(`Native decoder budget rejected "${file.name}"`);
      }

      updateClip(clipId, {
        duration: naturalDuration,
        outPoint: naturalDuration,
        source: {
          type: 'video',
          naturalDuration,
          mediaFileId,
          filePath,
        },
        transform: { ...DEFAULT_TRANSFORM },
        isLoading: false,
      });

      if (audioClipId) {
        updateClip(audioClipId, { duration: naturalDuration, outPoint: naturalDuration });
      }
    } catch (err) {
      log.warn('Native Helper failed, falling back to browser', err);
      nativeDecoder = null;
    }
  }

  // Fallback to HTMLVideoElement if not using native decoder
  if (!nativeDecoder) {
    video = createVideoElement(file);

    // Race: MP4Box container parsing vs HTMLVideoElement metadata
    // MP4Box reads from both start+end of file to handle camera MOV files
    // where the moov atom is at the end (not web-optimized)
    const [mp4Meta, _] = await Promise.all([
      getMP4MetadataFast(file, 6000),
      waitForVideoMetadata(video, 8000),
    ]);

    // Prefer the duration already established by media import. WebM recordings
    // can expose a short initial duration through HTMLVideoElement metadata.
    if (authoritativeNaturalDuration && Number.isFinite(authoritativeNaturalDuration) && authoritativeNaturalDuration > 0) {
      naturalDuration = authoritativeNaturalDuration;
      log.debug('Using imported media duration', { file: file.name, duration: naturalDuration.toFixed(2) });
    } else if (mp4Meta?.duration && mp4Meta.duration > 0) {
      naturalDuration = mp4Meta.duration;
      log.debug('Using MP4Box duration', { file: file.name, duration: naturalDuration.toFixed(2) });
    } else if (video.duration && isFinite(video.duration)) {
      naturalDuration = video.duration;
      log.debug('Using video element duration', { file: file.name, duration: naturalDuration.toFixed(2) });
    } else {
      // Last resort: estimate from file size
      naturalDuration = estimateDurationFromFileSize(file);
      log.warn('Duration unknown, estimated from file size', { file: file.name, duration: naturalDuration.toFixed(2), size: file.size });
    }

    // Set isLoading: false immediately so clip becomes interactive
    updateClip(clipId, {
      duration: naturalDuration,
      outPoint: naturalDuration,
      source: { type: 'video', naturalDuration, mediaFileId },
      transform: { ...DEFAULT_TRANSFORM },
      isLoading: false,
    });

    if (audioClipId) {
      updateClip(audioClipId, { duration: naturalDuration, outPoint: naturalDuration });
    }

    // Audio detection in background (non-blocking)
    // Use MP4Box result if available, otherwise detect separately
    if (mp4Meta) {
      if (!mp4Meta.hasAudio && audioClipId) {
        log.debug('MP4Box: no audio tracks, removing audio clip', { file: file.name });
        setClips(clips => clips.filter(c => c.id !== audioClipId));
      }
    } else {
      detectVideoAudio(file).then(videoHasAudio => {
        if (!videoHasAudio) {
          log.debug('Video has no audio tracks', { file: file.name });
          if (audioClipId) {
            log.debug('Removing audio clip for video without audio', { file: file.name });
            setClips(clips => clips.filter(c => c.id !== audioClipId));
          }
        }
      });
    }

    // Generate source-based thumbnails (1 per second) in background.
    // The thumbnail service owns its own detached generation video; the import
    // metadata probe video stays local and is released below.
    const isLargeFile = shouldSkipWaveform(file);
    if (thumbnailsEnabled && !isLargeFile && mediaFileId) {
      startVideoThumbnailGeneration(file, mediaFileId, naturalDuration);
    }

    releaseTemporaryMediaElement(video);
  } else {
    log.debug('Skipping thumbnails for NativeDecoder file', { file: file.name });
  }

  loadCachedProjectAnalysisForVideo(clipId, file.name, mediaFileId, setClips);

  // Load audio for linked clip (skip for NativeDecoder - browser can't decode ProRes/DNxHD audio)
  // For browser path, audio clip is already created and will be removed by background detectVideoAudio if no audio
  if (audioClipId && !nativeDecoder) {
    loadLinkedAudio(file, audioClipId, naturalDuration, mediaFileId, waveformsEnabled, updateClip, setClips);
  } else if (audioClipId && nativeDecoder) {
    log.debug('Skipping audio decoding for NativeDecoder file (audio clip kept)', { file: file.name });
    updateClip(audioClipId, {
      source: { type: 'audio', naturalDuration, mediaFileId },
      isLoading: false,
    });
  }

  // Sync to media store
  const mediaStore = useMediaStore.getState();
  if (!mediaStore.getFileByName(file.name)) {
    mediaStore.importFile(file);
  }
}


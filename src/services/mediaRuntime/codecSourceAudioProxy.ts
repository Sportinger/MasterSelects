// Audio for codec-provider sources (MXF, ProRes, HAP) comes only from their WAV
// proxy: the browser cannot open the container. Extracting it reads through the
// whole camera file, so it runs only for sources whose audio is actually on the
// timeline: adding a clip or starting its provider requests it, and after a
// short grace period the request proceeds only if an audio clip still uses the
// media (a linked audio clip removed right after adding never starts a job).

import { useMediaStore } from '../../stores/mediaStore';
import { Logger } from '../logger';

const log = Logger.create('RuntimePlayback');

export const CODEC_AUDIO_PROXY_GRACE_MS = 5_000;

/** Media ids whose audio proxy was started this session (never retried in a loop). */
const startedAudioProxies = new Set<string>();
/** Requests waiting for the grace period. */
const pendingAudioProxies = new Set<string>();

function needsAudioProxy(mediaFileId: string): boolean {
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  if (!mediaFile || mediaFile.hasAudio === false) return false;
  if (mediaFile.hasProxyAudio === true || mediaFile.audioProxyStatus === 'ready') return false;
  return mediaFile.audioProxyStatus !== 'generating' && mediaFile.audioProxyStatus !== 'error';
}

async function hasTimelineAudioClip(mediaFileId: string): Promise<boolean> {
  // Loaded lazily: the timeline store imports the runtime modules that call this.
  const { useTimelineStore } = await import('../../stores/timeline');
  return useTimelineStore.getState().clips.some((clip) => clip.source?.type === 'audio'
    && (clip.source.mediaFileId ?? clip.mediaFileId) === mediaFileId);
}

async function startIfAudible(mediaFileId: string): Promise<void> {
  pendingAudioProxies.delete(mediaFileId);
  if (startedAudioProxies.has(mediaFileId) || !needsAudioProxy(mediaFileId)) return;
  if (!await hasTimelineAudioClip(mediaFileId)) return;
  startedAudioProxies.add(mediaFileId);
  log.info('Requesting missing audio proxy for codec-provider source', { mediaFileId });
  await useMediaStore.getState().generateAudioProxy(mediaFileId);
}

export function requestCodecSourceAudioProxy(mediaFileId: string | undefined): void {
  if (!mediaFileId || startedAudioProxies.has(mediaFileId) || pendingAudioProxies.has(mediaFileId)) return;
  if (!needsAudioProxy(mediaFileId)) return;
  pendingAudioProxies.add(mediaFileId);
  // Detached from clip/provider setup: a failing request must never fail video playback.
  setTimeout(() => {
    startIfAudible(mediaFileId).catch((error: unknown) => log.warn('Audio proxy request failed', { mediaFileId, error }));
  }, CODEC_AUDIO_PROXY_GRACE_MS);
}

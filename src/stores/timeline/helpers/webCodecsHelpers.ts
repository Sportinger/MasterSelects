// WebCodecs initialization helpers
// Full Mode only (MP4Box + VideoDecoder, no HTMLVideoElement)

import { WebCodecsPlayer } from '../../../engine/WebCodecsPlayer';
import { WebCodecsAudioPlayer } from '../../../engine/WebCodecsAudioPlayer';
import { Logger } from '../../../services/logger';

const log = Logger.create('WebCodecsHelpers');

/**
 * Check if WebCodecs API is available in the browser.
 */
export function hasWebCodecsSupport(): boolean {
  return 'VideoDecoder' in window && 'VideoFrame' in window;
}

/**
 * Create an audio element with standard settings for timeline clips.
 */
export function createAudioElement(file: File): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.src = URL.createObjectURL(file);
  audio.preload = 'auto';
  return audio;
}

/**
 * Initialize WebCodecs Full Mode from a File.
 * Uses MP4Box + VideoDecoder (no HTMLVideoElement).
 * Returns the player and optionally an audio player if the file has audio.
 */
export async function initWebCodecsFullMode(
  file: File
): Promise<{ player: WebCodecsPlayer; audioPlayer: WebCodecsAudioPlayer | null }> {
  const player = new WebCodecsPlayer({ loop: false });
  const arrayBuffer = await file.arrayBuffer();
  await player.loadArrayBuffer(arrayBuffer);

  let audioPlayer: WebCodecsAudioPlayer | null = null;
  if (player.hasAudioTrack()) {
    try {
      audioPlayer = new WebCodecsAudioPlayer();
      await audioPlayer.loadFromArrayBuffer(arrayBuffer);
      log.info('WebCodecs audio player loaded', { file: file.name });
    } catch (e) {
      log.warn('WebCodecs audio decode failed', e);
      audioPlayer = null;
    }
  }

  return { player, audioPlayer };
}

import { Logger } from '../logger';
import { proxyFrameCache } from '../proxyFrameCache';

const log = Logger.create('CutTransition');
const AUDIO_PROXY_LOAD_RETRY_MS = 10_000;

/**
 * Result of resolving a clip's audio proxy. `pending` means the media file has
 * a ready proxy whose element is still loading: callers must stay silent for
 * those frames instead of playing the original source, which is often not
 * decodable by the browser (WMA, AC3, ALAC, ...). Only when the proxy cannot be
 * loaded or admitted is `pending` false with no element, and the original may
 * be tried (logged once per media file).
 */
export type AudioTrackProxyLookup = {
  element: HTMLAudioElement | null;
  pending: boolean;
};

export const NO_AUDIO_PROXY: AudioTrackProxyLookup = { element: null, pending: false };

export type AudioProxyFallbackReason = 'load-failed' | 'runtime-budget';

/** Loads shared audio proxy elements once per media file and backs off after a failed load. */
export class AudioTrackProxyLoadTracker {
  private loading = new Set<string>();
  private retryAt = new Map<string, number>();
  private reportedFallbacks = new Set<string>();

  /**
   * Starts (once) loading the shared proxy element of a media file with a ready
   * proxy. Returns true while the proxy is expected to arrive; false after a
   * failed load until the retry backoff expires, so playback can fall back.
   */
  request(mediaFileId: string): boolean {
    const retryAt = this.retryAt.get(mediaFileId);
    if (retryAt !== undefined && performance.now() < retryAt) return false;
    if (this.loading.has(mediaFileId)) return true;
    this.loading.add(mediaFileId);
    const markFailed = (error?: unknown) => {
      this.retryAt.set(mediaFileId, performance.now() + AUDIO_PROXY_LOAD_RETRY_MS);
      this.reportFallback(mediaFileId, 'load-failed', error ? { error: String(error) } : undefined);
    };
    void Promise.resolve()
      .then(() => proxyFrameCache.getAudioProxy(mediaFileId))
      .then((proxy) => {
        if (proxy?.currentSrc || proxy?.src) {
          this.retryAt.delete(mediaFileId);
          this.reportedFallbacks.delete(mediaFileId);
        } else {
          markFailed();
        }
      }, markFailed)
      .finally(() => this.loading.delete(mediaFileId));
    return true;
  }

  /** Says once per media file that playback falls back to the original source. */
  reportFallback(mediaFileId: string, reason: AudioProxyFallbackReason, details?: Record<string, unknown>): void {
    if (this.reportedFallbacks.has(mediaFileId)) return;
    this.reportedFallbacks.add(mediaFileId);
    log.warn('Audio proxy is marked ready but its element is unavailable; playing the original source, which may not be decodable', {
      mediaFileId,
      reason,
      ...details,
    });
  }
}

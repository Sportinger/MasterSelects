import { useCallback, useEffect, useState } from 'react';
import { NativeHelperClient, type VideoInfo } from '../../../../services/nativeHelper';
import {
  extractVideoId,
  fetchYouTubePreviewMetadata,
  type VideoUrlPreviewMetadata,
} from '../../../../services/mediaDiscovery/videoUrlDownloads';
import { isDownloadAvailable } from '../../../../services/youtubeDownloader';

interface FormatLookup {
  url: string;
  info: VideoInfo | null;
  error: string | null;
}

interface QuickLookup {
  url: string;
  metadata: VideoUrlPreviewMetadata | null;
}

export interface DownloadUrlPreview {
  helperConnected: boolean;
  /** The Native Helper is reading formats for the current URL. */
  loadingFormats: boolean;
  info: VideoInfo | null;
  formatError: string | null;
  /** Helper-independent YouTube oEmbed metadata (title, channel, thumbnail). */
  quickMetadata: VideoUrlPreviewMetadata | null;
  retryFormats: () => void;
}

/**
 * Resolves what a pasted video URL offers: instant YouTube oEmbed metadata and
 * the Native Helper's yt-dlp format recommendations once the helper is online.
 */
export function useDownloadUrlPreview(url: string | null): DownloadUrlPreview {
  const [helperConnected, setHelperConnected] = useState(isDownloadAvailable);
  const [formatLookup, setFormatLookup] = useState<FormatLookup | null>(null);
  const [quickLookup, setQuickLookup] = useState<QuickLookup | null>(null);
  const videoId = url ? extractVideoId(url) : null;

  useEffect(() => NativeHelperClient.onStatusChange((status) => {
    setHelperConnected(status === 'connected');
  }), []);

  useEffect(() => {
    if (!helperConnected || !url || formatLookup?.url === url) {
      return undefined;
    }

    let canceled = false;
    NativeHelperClient.listFormats(url)
      .then((info) => {
        if (canceled) return;
        setFormatLookup({
          url,
          info,
          error: info ? null : 'Could not read available formats for this URL.',
        });
      })
      .catch((caughtError: unknown) => {
        if (canceled) return;
        setFormatLookup({
          url,
          info: null,
          error: caughtError instanceof Error ? caughtError.message : 'Could not read available formats.',
        });
      });

    return () => {
      canceled = true;
    };
  }, [formatLookup?.url, helperConnected, url]);

  useEffect(() => {
    if (!url || !videoId || quickLookup?.url === url) {
      return undefined;
    }

    let canceled = false;
    void fetchYouTubePreviewMetadata(url, videoId).then((metadata) => {
      if (!canceled) setQuickLookup({ url, metadata });
    });

    return () => {
      canceled = true;
    };
  }, [quickLookup?.url, url, videoId]);

  const retryFormats = useCallback(() => setFormatLookup(null), []);
  const activeLookup = formatLookup?.url === url ? formatLookup : null;

  return {
    helperConnected,
    loadingFormats: Boolean(helperConnected && url && !activeLookup),
    info: activeLookup?.info ?? null,
    formatError: activeLookup?.error ?? null,
    quickMetadata: quickLookup?.url === url ? quickLookup.metadata : null,
    retryFormats,
  };
}

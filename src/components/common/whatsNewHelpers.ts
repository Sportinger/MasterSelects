import { BUILD_NOTICE, type ChangelogNotice as ChangelogNoticeConfig } from '../../version';
import type { NativeHelperPublishedRelease } from '../../services/nativeHelper/releases';

export type YouTubePlayerStateValue = -1 | 0 | 1 | 2 | 3 | 5;

export interface YouTubePlayerStateChangeEvent {
  data: YouTubePlayerStateValue;
}

export interface YouTubePlayerInstance {
  destroy: () => void;
}

export interface YouTubePlayerNamespace {
  Player: new (
    element: HTMLIFrameElement,
    options?: {
      events?: {
        onStateChange?: (event: YouTubePlayerStateChangeEvent) => void;
      };
    }
  ) => YouTubePlayerInstance;
  PlayerState: {
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    CUED: 5;
  };
  ready?: (callback: () => void) => void;
}

declare global {
  interface Window {
    YT?: YouTubePlayerNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeIframeApiPromise: Promise<YouTubePlayerNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YouTubePlayerNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube iframe API requires a browser environment.'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const scriptSrc = 'https://www.youtube.com/iframe_api';
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${scriptSrc}"]`);
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    const resolveIfReady = () => {
      if (window.YT?.Player) {
        resolve(window.YT);
        return true;
      }
      return false;
    };

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();
      resolveIfReady();
    };

    if (resolveIfReady()) {
      return;
    }

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      script.onerror = () => reject(new Error('Failed to load YouTube iframe API.'));
      document.head.appendChild(script);
    }

    window.setTimeout(() => {
      resolveIfReady();
    }, 0);
  });

  return youtubeIframeApiPromise;
}

export function getHelperBuildNotice(
  publishedRelease: NativeHelperPublishedRelease | null,
): ChangelogNoticeConfig | null {
  if (!BUILD_NOTICE) {
    return null;
  }

  const notice: ChangelogNoticeConfig = {
    ...BUILD_NOTICE,
  };

  if (publishedRelease && !notice.link) {
    notice.link = {
      label: `Native Helper v${publishedRelease.version}`,
      href: publishedRelease.url,
    };
  }

  return notice;
}

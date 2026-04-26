// SplashScreen - Welcome dialog shown on startup with featured video and notices

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  APP_VERSION,
  FEATURED_VIDEO,
  WIP_NOTICE,
  type ChangelogNotice as ChangelogNoticeConfig,
} from '../../version';
import {
  fetchLatestPublishedNativeHelperRelease,
  type NativeHelperPublishedRelease,
} from '../../services/nativeHelper/releases';
import { useSettingsStore } from '../../stores/settingsStore';
import { NoticeCard } from './WhatsNewDialog';
import {
  loadYouTubeIframeApi,
  getHelperBuildNotice,
  type YouTubePlayerInstance,
} from './whatsNewHelpers';

interface SplashScreenProps {
  onClose: () => void;
  onOpenChangelog: () => void;
}

export function SplashScreen({ onClose, onOpenChangelog }: SplashScreenProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [publishedHelperRelease, setPublishedHelperRelease] = useState<NativeHelperPublishedRelease | null>(null);
  const lastSeenChangelogVersion = useSettingsStore((s) => s.lastSeenChangelogVersion);
  const setShowChangelogOnStartup = useSettingsStore((s) => s.setShowChangelogOnStartup);
  const setLastSeenChangelogVersion = useSettingsStore((s) => s.setLastSeenChangelogVersion);
  const isCurrentVersionSuppressed = lastSeenChangelogVersion === APP_VERSION;
  const [dontShowAgain, setDontShowAgain] = useState(isCurrentVersionSuppressed);
  const featuredVideoFrameRef = useRef<HTMLIFrameElement | null>(null);
  const featuredVideoPlayerRef = useRef<YouTubePlayerInstance | null>(null);

  const buildNotice = useMemo(() => getHelperBuildNotice(publishedHelperRelease), [publishedHelperRelease]);
  const featuredNotices = useMemo(
    () =>
      [FEATURED_VIDEO?.banner, buildNotice, WIP_NOTICE].filter(
        (notice): notice is ChangelogNoticeConfig => Boolean(notice)
      ),
    [buildNotice]
  );
  const featuredVideoEmbedUrl = useMemo(
    () =>
      FEATURED_VIDEO
        ? `https://www.youtube.com/embed/${FEATURED_VIDEO.youtubeId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1${typeof window !== 'undefined' ? `&origin=${encodeURIComponent(window.location.origin)}` : ''}`
        : '',
    []
  );
  const attachCredentiallessVideoFrame = useCallback((node: HTMLIFrameElement | null) => {
    featuredVideoFrameRef.current = node;
    if (!node || !featuredVideoEmbedUrl) return;
    node.setAttribute('credentialless', '');
    if (node.src !== featuredVideoEmbedUrl) {
      node.src = featuredVideoEmbedUrl;
    }
  }, [featuredVideoEmbedUrl]);

  useEffect(() => {
    let cancelled = false;

    void fetchLatestPublishedNativeHelperRelease().then((release) => {
      if (!cancelled) {
        setPublishedHelperRelease(release);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDontShowAgain(isCurrentVersionSuppressed);
  }, [isCurrentVersionSuppressed]);

  useEffect(() => {
    if (!FEATURED_VIDEO || !featuredVideoFrameRef.current || !featuredVideoEmbedUrl) {
      return;
    }

    let disposed = false;

    loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed || !featuredVideoFrameRef.current) {
          return;
        }

        featuredVideoPlayerRef.current?.destroy();
        featuredVideoPlayerRef.current = new YT.Player(featuredVideoFrameRef.current, {
          events: {
            onStateChange: () => {
              // Video state changes handled by YouTube player
            },
          },
        });
      })
      .catch(() => {
        // Keep the embed usable even if the API script fails.
      });

    return () => {
      disposed = true;
      featuredVideoPlayerRef.current?.destroy();
      featuredVideoPlayerRef.current = null;
    };
  }, [featuredVideoEmbedUrl]);

  const persistSettings = useCallback(() => {
    if (dontShowAgain) {
      setShowChangelogOnStartup(false);
      setLastSeenChangelogVersion(APP_VERSION);
    } else {
      setShowChangelogOnStartup(true);
      setLastSeenChangelogVersion(null);
    }
  }, [dontShowAgain, setLastSeenChangelogVersion, setShowChangelogOnStartup]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    persistSettings();
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [onClose, isClosing, persistSettings]);

  const handleOpenChangelog = useCallback(() => {
    if (isClosing) return;
    persistSettings();
    setIsClosing(true);
    setTimeout(() => {
      onOpenChangelog();
    }, 200);
  }, [onOpenChangelog, isClosing, persistSettings]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  return (
    <div
      className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="welcome-overlay whats-new-dialog splash-dialog">
        {/* Header */}
        <div className="splash-header">
          <div className="splash-header-left">
            <div className="changelog-heading">
              <span className="changelog-brand" aria-label="MasterSelects">
                <span className="changelog-brand-master">Master</span>
                <span className="changelog-brand-selects">Selects</span>
              </span>
            </div>
          </div>
          <div className="splash-header-right">
            <span className="changelog-version">v{APP_VERSION}</span>
          </div>
        </div>

        {/* Content */}
        <div className="splash-content">
          {/* Featured Video - full width */}
          {FEATURED_VIDEO && (
            <div className="splash-video">
              <div className="changelog-video-shell">
                <div className="changelog-video-container">
                  <iframe
                    className="changelog-video-frame"
                    title={FEATURED_VIDEO.title}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                    ref={attachCredentiallessVideoFrame}
                  />
                </div>
                <a
                  className="changelog-video-fallback"
                  href={`https://www.youtube.com/watch?v=${FEATURED_VIDEO.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open on YouTube if the embed is blocked
                </a>
              </div>
            </div>
          )}

          {/* Notices */}
          {featuredNotices.length > 0 && (
            <div className="splash-notices">
              {featuredNotices.map((notice, index) => (
                <NoticeCard
                  key={`${notice.type}-${notice.title}`}
                  notice={notice}
                  staggerIndex={index}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="splash-footer">
          <label className="changelog-dont-show">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>Don't auto-show this version again</span>
          </label>
          <div className="splash-footer-buttons">
            <button className="splash-changelog-button" onClick={handleOpenChangelog}>
              Full Changelog
            </button>
            <button className="changelog-header-button" onClick={handleClose}>
              Got it!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

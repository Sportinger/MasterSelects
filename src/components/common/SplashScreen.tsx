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
import {
  loadYouTubeIframeApi,
  NoticeCard,
  getHelperBuildNotice,
  type YouTubePlayerInstance,
} from './WhatsNewDialog';

const POLL_STORAGE_KEY = 'masterselects-splash-poll-v1';
const POLL_API = '/api/poll';
const IS_DEV = import.meta.env.DEV;

interface PollResults {
  great: number;
  'no-sub': number;
  total: number;
  voted?: string;
}

function SplashPoll() {
  // In dev mode: never restore from localStorage so poll always shows fresh
  const [voted, setVoted] = useState<string | null>(() => {
    if (IS_DEV) return null;
    try { return localStorage.getItem(POLL_STORAGE_KEY); } catch { return null; }
  });
  const [results, setResults] = useState<PollResults | null>(null);

  // Fetch current results on mount
  useEffect(() => {
    fetch(POLL_API)
      .then((r) => r.json() as Promise<PollResults>)
      .then((data) => {
        setResults(data);
        // If server says this IP already voted, sync local state (skip in dev)
        if (!IS_DEV && data.voted && !voted) {
          setVoted(data.voted);
          try { localStorage.setItem(POLL_STORAGE_KEY, data.voted); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* offline or local dev — poll works locally only */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVote = (choice: string) => {
    setVoted(choice);
    if (!IS_DEV) {
      try { localStorage.setItem(POLL_STORAGE_KEY, choice); } catch { /* ignore */ }
    }

    fetch(POLL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    })
      .then((r) => r.json() as Promise<PollResults>)
      .then((data) => setResults(data))
      .catch(() => {
        // Offline fallback — show optimistic local result
        setResults((prev) => {
          const base = prev ?? { great: 0, 'no-sub': 0, total: 0 };
          const updated = { ...base, total: base.total + 1 };
          if (choice === 'great') updated.great++;
          else updated['no-sub']++;
          return updated;
        });
      });
  };

  // Already voted (production) — don't render poll at all
  if (voted && !IS_DEV) {
    return null;
  }

  const greatPct = results && results.total > 0
    ? Math.round((results.great / results.total) * 100) : 0;
  const noSubPct = results && results.total > 0
    ? Math.round((results['no-sub'] / results.total) * 100) : 0;

  return (
    <div className="splash-poll">
      <p className="splash-poll-question">
        Would you like to have the ability to buy AI credits for AI chat and video generation without your own API key?
      </p>
      {voted ? (
        <div className="splash-poll-result">
          <span className="splash-poll-thanks">
            {voted === 'great' ? 'Noted, thanks!' : 'Fair point! No subscriptions, promise.'}
          </span>
          {results && results.total > 0 && (
            <div className="splash-poll-bars">
              <div className="splash-poll-bar-row">
                <span className="splash-poll-bar-label">Great Idea</span>
                <div className="splash-poll-bar-track">
                  <div
                    className="splash-poll-bar-fill splash-poll-bar-fill-yes"
                    style={{ width: `${greatPct}%` }}
                  />
                </div>
                <span className="splash-poll-bar-pct">{greatPct}%</span>
              </div>
              <div className="splash-poll-bar-row">
                <span className="splash-poll-bar-label">No Subs!</span>
                <div className="splash-poll-bar-track">
                  <div
                    className="splash-poll-bar-fill splash-poll-bar-fill-no"
                    style={{ width: `${noSubPct}%` }}
                  />
                </div>
                <span className="splash-poll-bar-pct">{noSubPct}%</span>
              </div>
              <span className="splash-poll-total">{results.total} {results.total === 1 ? 'vote' : 'votes'}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="splash-poll-options">
          <button className="splash-poll-btn splash-poll-btn-yes" onClick={() => handleVote('great')}>
            <span className="splash-poll-btn-emoji">👍</span>
            <span>Great Idea</span>
          </button>
          <button className="splash-poll-btn splash-poll-btn-no" onClick={() => handleVote('no-sub')}>
            <span className="splash-poll-btn-emoji">🙅</span>
            <span>No Subscriptions!</span>
          </button>
        </div>
      )}
    </div>
  );
}

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
          {/* Poll */}
          <SplashPoll />

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

        {/* Scribble note */}
        <div className="splash-scribble-note" aria-hidden="true">
          <span className="splash-scribble-text">do you have a job for me :) ?</span>
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

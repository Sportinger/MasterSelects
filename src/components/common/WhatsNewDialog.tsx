// WhatsNewDialog - Shows changelog grouped by time periods
// Shared components (NoticeCard, ReleaseCalendar, ChangeItem, etc.) are also exported
// for use by SplashScreen.

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import {
  APP_VERSION,
  BUILD_NOTICE,
  getChangelogCalendar,
  getGroupedChangelog,
  type ChangelogCalendarDay,
  type ChangeEntry,
  type ChangelogNotice as ChangelogNoticeConfig,
} from '../../version';
import {
  NATIVE_HELPER_RELEASES_URL,
  type NativeHelperPublishedRelease,
} from '../../services/nativeHelper/releases';

interface WhatsNewDialogProps {
  onClose: () => void;
}

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

// Icon components for change types
function NewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FixIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 7l3.5 3.5L12 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImproveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 11V3M4 5l3-3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefactorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 4h8M3 7h5M3 10h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

function NoticeIcon({ type }: { type: ChangelogNoticeConfig['type'] }) {
  if (type === 'warning') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2L1 14h14L8 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M8 6v4M8 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }

  if (type === 'success') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4.5 8.2l2.1 2.1L11.5 5.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  if (type === 'danger') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 4.5v4.5M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 7v4M8 5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function NoticeCard({
  notice,
  className = '',
  staggerIndex = 0,
}: {
  notice: ChangelogNoticeConfig;
  className?: string;
  staggerIndex?: number;
}) {
  const noticeStyle = notice.animated
    ? ({ '--changelog-notice-delay': `${staggerIndex * 0.8}s` } as CSSProperties)
    : undefined;

  return (
    <div
      className={`changelog-notice ${notice.annotation ? 'changelog-notice-with-annotation' : ''} ${className}`.trim()}
      style={noticeStyle}
    >
      <div className={`changelog-notice-body changelog-notice-${notice.type} ${notice.animated ? 'changelog-notice-animated' : ''}`.trim()}>
        <div className="changelog-notice-icon">
          <NoticeIcon type={notice.type} />
        </div>
        <div className="changelog-notice-content">
          <span className="changelog-notice-title">{notice.title}</span>
          <span className="changelog-notice-message">
            {notice.message && <>{notice.message}{notice.link ? ' ' : ''}</>}
            {notice.link && (
              <>
                <a
                  className="changelog-notice-link"
                  href={notice.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {notice.link.label}
                </a>
                {notice.link.suffix && <> {notice.link.suffix}</>}
              </>
            )}
          </span>
        </div>
      </div>
      {notice.annotation && (
        <div className="changelog-notice-scribble" aria-hidden="true">
          <svg className="changelog-notice-scribble-arrow" viewBox="0 0 34 18" fill="none">
            <path d="M30 15C20 15 14 12 10 5" />
            <path d="M8 7.5L10 4.5L13.5 5.8" />
          </svg>
          <span className="changelog-notice-scribble-text">{notice.annotation.text}</span>
        </div>
      )}
    </div>
  );
}

export function getHelperBuildNotice(
  publishedRelease: NativeHelperPublishedRelease | null,
): ChangelogNoticeConfig | null {
  if (!BUILD_NOTICE) {
    return null;
  }

  // Use BUILD_NOTICE as-is (title + message from version.ts)
  const notice: ChangelogNoticeConfig = {
    ...BUILD_NOTICE,
  };

  // Append Native Helper download link if a release is available
  if (publishedRelease) {
    notice.link = {
      label: `Native Helper v${publishedRelease.version}`,
      href: publishedRelease.url,
    };
  }

  return notice;
}

export function ReleaseCalendar({ weeks }: { weeks: ChangelogCalendarDay[][] }) {
  return (
    <div className="changelog-calendar" aria-label="Recent changelog activity">
      {weeks.map((week, weekIndex) => (
        <div key={`week-${weekIndex}`} className="changelog-calendar-week">
          {week.map((day) => (
            <div
              key={day.date}
              className={`changelog-calendar-day changelog-calendar-level-${day.level} changelog-calendar-community-level-${day.communityLevel} ${day.communityCount > 0 ? 'has-community' : ''} ${day.isFuture ? 'is-future' : ''} ${day.isToday ? 'is-today' : ''} ${day.isOutOfRange ? 'is-outside-range' : ''}`}
              aria-label={day.isOutOfRange ? undefined : day.tooltip}
            >
              {!day.isOutOfRange && (
                <>
                  <span className="changelog-calendar-fill changelog-calendar-fill-main" />
                  {day.communityCount > 0 && (
                    <span className="changelog-calendar-fill changelog-calendar-fill-community" />
                  )}
                </>
              )}
              {!day.isOutOfRange && (
                <span className="changelog-calendar-tooltip">{day.tooltip}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ChangeItem({ change }: { change: ChangeEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDescription = !!change.description;
  const hasCommits = change.commits && change.commits.length > 0;
  const hasExpandableContent = hasDescription || hasCommits;
  const isCommunityHighlight = change.highlight === 'community';

  const handleCommitClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't toggle expand when clicking link
  };

  return (
    <div
      className={`changelog-item changelog-item-${change.type} ${hasExpandableContent ? 'has-description' : ''} ${expanded ? 'expanded' : ''} ${isCommunityHighlight ? 'changelog-item-community' : ''}`.trim()}
      onClick={() => hasExpandableContent && setExpanded(!expanded)}
    >
      <div className="changelog-item-header">
        <span className={`changelog-icon changelog-icon-${change.type}`}>
          {change.type === 'new' && <NewIcon />}
          {change.type === 'fix' && <FixIcon />}
          {change.type === 'improve' && <ImproveIcon />}
          {change.type === 'refactor' && <RefactorIcon />}
        </span>
        <span className="changelog-title">{change.title}</span>
        {isCommunityHighlight && (
          <span className="changelog-badge changelog-badge-community">Community</span>
        )}
        {hasCommits && (
          <span className="changelog-commit-count">{change.commits!.length}</span>
        )}
        {hasExpandableContent && (
          <span className="changelog-expand">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>
      {hasExpandableContent && (
        <div className="changelog-description-wrapper">
          <div className="changelog-description">
            {change.description && <span>{change.description}</span>}
            {change.contributorName && (
              change.contributorUrl ? (
                <a
                  href={change.contributorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="changelog-contributor-link"
                  onClick={handleCommitClick}
                >
                  Community contribution by {change.contributorName}
                </a>
              ) : (
                <span className="changelog-contributor-label">
                  Community contribution by {change.contributorName}
                </span>
              )
            )}
            {hasCommits && (
              <div className="changelog-commits">
                {change.commits!.map((hash) => (
                  <a
                    key={hash}
                    href={`https://github.com/Sportinger/MasterSelects/commit/${hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="changelog-commit-link"
                    onClick={handleCommitClick}
                  >
                    <GitHubIcon />
                    <span>{hash.substring(0, 7)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WhatsNewDialog({ onClose }: WhatsNewDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'new' | 'fix' | 'improve' | 'refactor'>('all');

  const groupedChangelog = useMemo(() => getGroupedChangelog(), []);
  const changelogCalendar = useMemo(() => getChangelogCalendar(), []);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [onClose, isClosing]);

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

  // Filter changes based on active tab
  const filteredGroups = useMemo(() => {
    if (activeTab === 'all') return groupedChangelog;
    return groupedChangelog
      .map(group => ({
        ...group,
        changes: group.changes.filter(c => c.type === activeTab),
      }))
      .filter(group => group.changes.length > 0);
  }, [groupedChangelog, activeTab]);

  // Count changes by type
  const counts = useMemo(() => {
    const all = groupedChangelog.flatMap(g => g.changes);
    return {
      all: all.length,
      new: all.filter(c => c.type === 'new').length,
      fix: all.filter(c => c.type === 'fix').length,
      improve: all.filter(c => c.type === 'improve').length,
      refactor: all.filter(c => c.type === 'refactor').length,
    };
  }, [groupedChangelog]);

  return (
    <div
      className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="welcome-overlay whats-new-dialog changelog-dialog">
        {/* Header */}
        <div className="changelog-header">
          <div className="changelog-header-left">
            <div className="changelog-heading">
              <span className="changelog-brand" aria-label="MasterSelects">
                <span className="changelog-brand-master">Master</span>
                <span className="changelog-brand-selects">Selects</span>
              </span>
              <h2 className="changelog-header-title">Changelog</h2>
            </div>
          </div>
          <div className="changelog-header-center">
            <button className="changelog-header-button" onClick={handleClose}>
              Close
            </button>
          </div>
          <div className="changelog-header-right">
            <span className="changelog-version">v{APP_VERSION}</span>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="changelog-content">
          {/* Calendar - full width at top */}
          <div className="changelog-calendar-section">
            <ReleaseCalendar weeks={changelogCalendar} />
          </div>

          {/* Filter tabs */}
          <div className="changelog-tabs">
            <button
              className={`changelog-tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All <span className="changelog-tab-count">{counts.all}</span>
            </button>
            <button
              className={`changelog-tab changelog-tab-new ${activeTab === 'new' ? 'active' : ''}`}
              onClick={() => setActiveTab('new')}
            >
              New <span className="changelog-tab-count">{counts.new}</span>
            </button>
            <button
              className={`changelog-tab changelog-tab-fix ${activeTab === 'fix' ? 'active' : ''}`}
              onClick={() => setActiveTab('fix')}
            >
              Fixes <span className="changelog-tab-count">{counts.fix}</span>
            </button>
            <button
              className={`changelog-tab changelog-tab-improve ${activeTab === 'improve' ? 'active' : ''}`}
              onClick={() => setActiveTab('improve')}
            >
              Improved <span className="changelog-tab-count">{counts.improve}</span>
            </button>
            <button
              className={`changelog-tab changelog-tab-refactor ${activeTab === 'refactor' ? 'active' : ''}`}
              onClick={() => setActiveTab('refactor')}
            >
              Refactor <span className="changelog-tab-count">{counts.refactor}</span>
            </button>
          </div>

          {filteredGroups.map((group, groupIndex) => {
            // Split changes into left and right columns (alternating)
            const leftChanges = group.changes.filter((_, i) => i % 2 === 0);
            const rightChanges = group.changes.filter((_, i) => i % 2 === 1);

            return (
              <div key={group.label} className="changelog-group">
                <div className="changelog-group-header">
                  <span className="changelog-group-label">{group.label}</span>
                  <span className="changelog-group-date">{group.dateRange}</span>
                  <div className="changelog-group-line" />
                </div>
                <div className="changelog-group-items">
                  <div className="changelog-column">
                    {leftChanges.map((change, i) => (
                      <ChangeItem key={`${groupIndex}-left-${i}`} change={change} />
                    ))}
                  </div>
                  <div className="changelog-column">
                    {rightChanges.map((change, i) => (
                      <ChangeItem key={`${groupIndex}-right-${i}`} change={change} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

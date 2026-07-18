// SplashScreen - Welcome dialog shown on startup with featured video and notices

import { useState, useEffect, useCallback, useMemo } from 'react';
import './WelcomeOverlay.css';
import './WhatsNewDialog.css';
import './SplashScreen.css';
import {
  APP_VERSION,
  FEATURED_VIDEO,
  WIP_NOTICE,
  type ChangelogNotice as ChangelogNoticeConfig,
} from '../../version';
import { useSettingsStore } from '../../stores/settingsStore';
import { NoticeCard } from './WhatsNewDialog';
import { getHelperBuildNotice } from './whatsNewHelpers';

interface SplashScreenProps {
  onClose: () => void;
  onOpenChangelog: () => void;
}

export function SplashScreen({ onClose, onOpenChangelog }: SplashScreenProps) {
  const [isClosing, setIsClosing] = useState(false);
  const lastSeenChangelogVersion = useSettingsStore((s) => s.lastSeenChangelogVersion);
  const setShowChangelogOnStartup = useSettingsStore((s) => s.setShowChangelogOnStartup);
  const setLastSeenChangelogVersion = useSettingsStore((s) => s.setLastSeenChangelogVersion);
  const isCurrentVersionSuppressed = lastSeenChangelogVersion === APP_VERSION;
  const [dontShowAgain, setDontShowAgain] = useState(isCurrentVersionSuppressed);

  const buildNotice = useMemo(() => getHelperBuildNotice(null), []);
  const featuredNotices = useMemo(() => {
    // The featured banner and build notice can carry identical release copy;
    // collapse content-identical cards but keep extras (helper link, annotation).
    const byIdentity = new Map<string, ChangelogNoticeConfig>();
    for (const notice of [FEATURED_VIDEO?.banner, buildNotice, WIP_NOTICE]) {
      if (!notice) continue;
      const identity = JSON.stringify([notice.type, notice.title, notice.message]);
      const existing = byIdentity.get(identity);
      if (!existing) {
        byIdentity.set(identity, notice);
        continue;
      }
      byIdentity.set(identity, {
        ...existing,
        link: existing.link ?? notice.link,
        annotation: existing.annotation ?? notice.annotation,
      });
    }
    return [...byIdentity.values()];
  }, [buildNotice]);
  useEffect(() => {
    setDontShowAgain(isCurrentVersionSuppressed);
  }, [isCurrentVersionSuppressed]);

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
                  <video
                    className="changelog-video-frame"
                    aria-label={FEATURED_VIDEO.title}
                    controls
                    poster="/preview.png"
                    preload="metadata"
                    src={FEATURED_VIDEO.source}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notices */}
          {featuredNotices.length > 0 && (
            <div className="splash-notices">
              {featuredNotices.map((notice, index) => (
                <NoticeCard
                  key={`${notice.type}-${notice.title}-${index}`}
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

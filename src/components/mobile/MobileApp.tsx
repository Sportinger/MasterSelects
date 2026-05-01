// Mobile App - unsupported-device gate

import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import './mobile.css';

export function MobileApp() {
  const setForceDesktopMode = useSettingsStore((s) => s.setForceDesktopMode);

  const openDesktopEditor = useCallback(() => {
    setForceDesktopMode(true);
  }, [setForceDesktopMode]);

  return (
    <div className="welcome-overlay-backdrop" style={{ animationDelay: '0s' }}>
      <div className="welcome-overlay" style={{ animationDelay: '0s' }}>
        <div className="welcome-browser-warning" style={{
          background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(217, 119, 6, 0.1) 100%)',
          borderColor: 'rgba(251, 191, 36, 0.35)',
          maxWidth: '360px',
        }}>
          <svg className="welcome-browser-warning-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          <span className="welcome-browser-warning-label" style={{ color: '#fbbf24' }}>Mobile</span>
          <span className="welcome-browser-warning-name">Geht noch nicht.</span>
          <span className="welcome-browser-warning-desc">
            Bitte Desktop nutzen. Die mobile Ansicht ist noch nicht bereit.
          </span>

          <button
            className="welcome-browser-warning-btn"
            onClick={openDesktopEditor}
            style={{ marginTop: '16px' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 5h16v11H4z" />
              <path d="M8 21h8" />
              <path d="M12 16v5" />
            </svg>
            Trotzdem Desktop oeffnen
          </button>
        </div>
      </div>
    </div>
  );
}

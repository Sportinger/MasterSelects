// LegalDialog - Imprint, Privacy Policy, Contact (multilingual)

import React, { useState, useEffect, useCallback } from 'react';
import { ContactEN, ImprintEN, PrivacyEN } from './legal/english';
import { ContactDE, ImprintDE, PrivacyDE } from './legal/german';
import './authBillingDialogs.css';

type LegalPage = 'imprint' | 'privacy' | 'contact';
type LegalLang = 'en' | 'de';

const LANGUAGES: { code: LegalLang; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
];

// --- i18n strings ---

type ContentFn = () => React.ReactElement;

const T: Record<LegalLang, {
  kicker: string;
  tabs: { imprint: string; privacy: string; contact: string };
  imprint: { title: string; content: ContentFn };
  privacy: { title: string; content: ContentFn };
  contact: { title: string; content: ContentFn };
}> = {
  // ─── English (default) ───
  en: {
    kicker: 'Legal',
    tabs: { imprint: 'Imprint', privacy: 'Privacy', contact: 'Contact' },
    imprint: { title: 'Imprint', content: ImprintEN },
    privacy: { title: 'Privacy Policy', content: PrivacyEN },
    contact: { title: 'Contact', content: ContactEN },
  },
  // ─── Deutsch ───
  de: {
    kicker: 'Rechtliches',
    tabs: { imprint: 'Impressum', privacy: 'Datenschutz', contact: 'Kontakt' },
    imprint: { title: 'Impressum', content: ImprintDE },
    privacy: { title: 'Datenschutzerklärung', content: PrivacyDE },
    contact: { title: 'Kontakt', content: ContactDE },
  },
};

function detectBrowserLang(): LegalLang {
  const nav = navigator.language?.toLowerCase() ?? '';
  if (nav.startsWith('de')) return 'de';
  return 'en';
}

// --- Dialog ---

interface LegalDialogProps {
  onClose: () => void;
  initialLang?: LegalLang;
  initialPage?: LegalPage;
}

export function LegalDialog({ onClose, initialLang, initialPage = 'imprint' }: LegalDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [page, setPage] = useState<LegalPage>(initialPage);
  const [lang, setLang] = useState<LegalLang>(() => initialLang ?? detectBrowserLang());

  const t = T[lang];

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => onClose(), 200);
  }, [onClose, isClosing]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const Content = t[page].content;

  return (
    <div
      className={`auth-billing-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="auth-billing-dialog auth-billing-dialog-wide" aria-modal="true" role="dialog">
        {/* Header */}
        <div className="auth-billing-header">
          <div>
            <div className="auth-billing-kicker">{t.kicker}</div>
            <h2>{t[page].title}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              aria-label="Language"
              className="legal-lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value as LegalLang)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <button aria-label="Close legal information" className="auth-billing-close" onClick={handleClose}>✕</button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="legal-tabs">
          <button className={`legal-tab ${page === 'imprint' ? 'active' : ''}`} onClick={() => setPage('imprint')}>
            {t.tabs.imprint}
          </button>
          <button className={`legal-tab ${page === 'privacy' ? 'active' : ''}`} onClick={() => setPage('privacy')}>
            {t.tabs.privacy}
          </button>
          <button className={`legal-tab ${page === 'contact' ? 'active' : ''}`} onClick={() => setPage('contact')}>
            {t.tabs.contact}
          </button>
        </div>

        {/* Content */}
        <div className="legal-content">
          <Content />
        </div>
      </div>
    </div>
  );
}


export type { LegalPage };

// LegalDialog - Imprint, Privacy Policy, Terms, Withdrawal, Cancellation, Contact (multilingual)

import React, { useState, useEffect, useCallback } from 'react';
import { ContactEN, ImprintEN, PrivacyEN } from './legal/english';
import { ContactDE, ImprintDE, PrivacyDE } from './legal/german';
import { CancellationPage, TermsPage, WithdrawalPage } from './legal/consumerContractPages';
import { detectLegalLang, type LegalLang } from './legal/legalLang';
import './authBillingDialogs.css';

type LegalPage = 'imprint' | 'privacy' | 'terms' | 'withdrawal' | 'cancellation' | 'contact';

const PAGE_ORDER: LegalPage[] = ['imprint', 'privacy', 'terms', 'withdrawal', 'cancellation', 'contact'];

const LANGUAGES: { code: LegalLang; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
];

// --- i18n strings ---

type ContentFn = () => React.ReactElement;

type LegalCopy = {
  kicker: string;
  pages: Record<LegalPage, { content: ContentFn; tab: string; title: string }>;
};

const T: Record<LegalLang, LegalCopy> = {
  // ─── English (default) ───
  en: {
    kicker: 'Legal',
    pages: {
      imprint: { content: ImprintEN, tab: 'Imprint', title: 'Imprint' },
      privacy: { content: PrivacyEN, tab: 'Privacy', title: 'Privacy Policy' },
      terms: { content: () => <TermsPage lang="en" />, tab: 'Terms', title: 'Terms and Conditions' },
      withdrawal: { content: () => <WithdrawalPage lang="en" />, tab: 'Withdrawal', title: 'Withdrawal Policy' },
      cancellation: { content: () => <CancellationPage lang="en" />, tab: 'Cancel', title: 'Cancel contracts here' },
      contact: { content: ContactEN, tab: 'Contact', title: 'Contact' },
    },
  },
  // ─── Deutsch ───
  de: {
    kicker: 'Rechtliches',
    pages: {
      imprint: { content: ImprintDE, tab: 'Impressum', title: 'Impressum' },
      privacy: { content: PrivacyDE, tab: 'Datenschutz', title: 'Datenschutzerklärung' },
      terms: { content: () => <TermsPage lang="de" />, tab: 'AGB', title: 'Allgemeine Geschäftsbedingungen' },
      withdrawal: { content: () => <WithdrawalPage lang="de" />, tab: 'Widerruf', title: 'Widerrufsbelehrung' },
      cancellation: { content: () => <CancellationPage lang="de" />, tab: 'Kündigen', title: 'Verträge hier kündigen' },
      contact: { content: ContactDE, tab: 'Kontakt', title: 'Kontakt' },
    },
  },
};

// --- Dialog ---

interface LegalDialogProps {
  onClose: () => void;
  initialLang?: LegalLang;
  initialPage?: LegalPage;
}

export function LegalDialog({ onClose, initialLang, initialPage = 'imprint' }: LegalDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [page, setPage] = useState<LegalPage>(initialPage);
  const [lang, setLang] = useState<LegalLang>(() => initialLang ?? detectLegalLang());

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

  const Content = t.pages[page].content;

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
            <h2>{t.pages[page].title}</h2>
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
          {PAGE_ORDER.map((candidate) => (
            <button
              key={candidate}
              className={`legal-tab ${page === candidate ? 'active' : ''}`}
              onClick={() => setPage(candidate)}
              onPointerUp={(event) => event.currentTarget.blur()}
              type="button"
            >
              {t.pages[candidate].tab}
            </button>
          ))}
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

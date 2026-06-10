// LegalDialog - Imprint, Privacy Policy, Contact (multilingual)

import React, { useState, useEffect, useCallback } from 'react';
import { ContactZH, ImprintZH, PrivacyZH } from './legal/chinese';
import { ContactEN, ImprintEN, PrivacyEN } from './legal/english';
import { ContactFR, ImprintFR, PrivacyFR } from './legal/french';
import { ContactDE, ImprintDE, PrivacyDE } from './legal/german';
import { ContactJA, ImprintJA, PrivacyJA } from './legal/japanese';
import { ContactKO, ImprintKO, PrivacyKO } from './legal/korean';
import { ContactPT, ImprintPT, PrivacyPT } from './legal/portuguese';
import { ContactES, ImprintES, PrivacyES } from './legal/spanish';

type LegalPage = 'imprint' | 'privacy' | 'contact';
type LegalLang = 'en' | 'de' | 'fr' | 'es' | 'ja' | 'ko' | 'zh' | 'pt';

const LANGUAGES: { code: LegalLang; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
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
  // ─── Français ───
  fr: {
    kicker: 'Mentions légales',
    tabs: { imprint: 'Mentions légales', privacy: 'Confidentialité', contact: 'Contact' },
    imprint: { title: 'Mentions légales', content: ImprintFR },
    privacy: { title: 'Politique de confidentialité', content: PrivacyFR },
    contact: { title: 'Contact', content: ContactFR },
  },
  // ─── Español ───
  es: {
    kicker: 'Legal',
    tabs: { imprint: 'Aviso legal', privacy: 'Privacidad', contact: 'Contacto' },
    imprint: { title: 'Aviso legal', content: ImprintES },
    privacy: { title: 'Política de privacidad', content: PrivacyES },
    contact: { title: 'Contacto', content: ContactES },
  },
  // ─── Português ───
  pt: {
    kicker: 'Legal',
    tabs: { imprint: 'Imprensa', privacy: 'Privacidade', contact: 'Contato' },
    imprint: { title: 'Aviso legal', content: ImprintPT },
    privacy: { title: 'Política de privacidade', content: PrivacyPT },
    contact: { title: 'Contato', content: ContactPT },
  },
  // ─── 日本語 ───
  ja: {
    kicker: '法的情報',
    tabs: { imprint: '運営者情報', privacy: 'プライバシー', contact: 'お問い合わせ' },
    imprint: { title: '運営者情報', content: ImprintJA },
    privacy: { title: 'プライバシーポリシー', content: PrivacyJA },
    contact: { title: 'お問い合わせ', content: ContactJA },
  },
  // ─── 한국어 ───
  ko: {
    kicker: '법적 정보',
    tabs: { imprint: '운영자 정보', privacy: '개인정보', contact: '연락처' },
    imprint: { title: '운영자 정보', content: ImprintKO },
    privacy: { title: '개인정보 처리방침', content: PrivacyKO },
    contact: { title: '연락처', content: ContactKO },
  },
  // ─── 中文 ───
  zh: {
    kicker: '法律信息',
    tabs: { imprint: '运营信息', privacy: '隐私政策', contact: '联系方式' },
    imprint: { title: '运营信息', content: ImprintZH },
    privacy: { title: '隐私政策', content: PrivacyZH },
    contact: { title: '联系方式', content: ContactZH },
  },
};

function detectBrowserLang(): LegalLang {
  const nav = navigator.language?.toLowerCase() ?? '';
  if (nav.startsWith('de')) return 'de';
  if (nav.startsWith('fr')) return 'fr';
  if (nav.startsWith('es')) return 'es';
  if (nav.startsWith('pt')) return 'pt';
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('ko')) return 'ko';
  if (nav.startsWith('zh')) return 'zh';
  return 'en';
}

// --- Dialog ---

interface LegalDialogProps {
  onClose: () => void;
  initialPage?: LegalPage;
}

export function LegalDialog({ onClose, initialPage = 'imprint' }: LegalDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [page, setPage] = useState<LegalPage>(initialPage);
  const [lang, setLang] = useState<LegalLang>(detectBrowserLang);

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
      <div className="auth-billing-dialog auth-billing-dialog-wide">
        {/* Header */}
        <div className="auth-billing-header">
          <div>
            <div className="auth-billing-kicker">{t.kicker}</div>
            <h2>{t[page].title}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              className="legal-lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value as LegalLang)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <button className="auth-billing-close" onClick={handleClose}>✕</button>
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

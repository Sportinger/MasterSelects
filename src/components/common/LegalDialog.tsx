// LegalDialog - Imprint, Privacy Policy, Contact (multilingual)

import React, { useState, useEffect, useCallback } from 'react';

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

// =====================================================
// ENGLISH
// =====================================================

function ImprintEN() {
  return (
    <div className="legal-text">
      <h3>Information according to § 5 TMG (German Telemedia Act)</h3>
      <p>Roman Kuskowski<br />[Address to be added]</p>

      <h3>Contact</h3>
      <p>Email: admin@masterselects.com</p>

      <h3>Responsible for content according to § 55 Abs. 2 RStV</h3>
      <p>Roman Kuskowski<br />[Address to be added]</p>

      <h3>EU Online Dispute Resolution</h3>
      <p>
        The European Commission provides a platform for online dispute resolution (ODR):{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
          https://ec.europa.eu/consumers/odr/
        </a>
      </p>

      <h3>Disclaimer</h3>
      <h4>Liability for Content</h4>
      <p>
        The contents of our pages were created with the greatest care. However, we cannot guarantee the accuracy,
        completeness, or timeliness of the content. As a service provider, we are responsible for our own content
        on these pages under general law according to § 7 (1) TMG. According to §§ 8-10 TMG, we are not obligated
        to monitor transmitted or stored third-party information.
      </p>

      <h4>Liability for Links</h4>
      <p>
        Our website contains links to external third-party websites over whose content we have no control.
        The respective provider or operator of the linked pages is always responsible for their content.
      </p>

      <h4>Copyright</h4>
      <p>
        MasterSelects is open source software, published on GitHub at{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">
          github.com/Sportinger/MasterSelects
        </a>.
      </p>
    </div>
  );
}

function PrivacyEN() {
  return (
    <div className="legal-text">
      <h3>1. Privacy at a Glance</h3>
      <h4>General Information</h4>
      <p>
        The following provides an overview of what happens to your personal data when you use MasterSelects.
        Personal data is any data that can be used to personally identify you.
      </p>
      <h4>Data Processing</h4>
      <p>
        <strong>MasterSelects is primarily a local application.</strong> All video, image, and audio files
        are processed exclusively on your device. Your media files never leave your computer.
      </p>

      <h3>2. Data Controller</h3>
      <p>Roman Kuskowski<br />Email: admin@masterselects.com</p>

      <h3>3. Hosting</h3>
      <p>
        This website is hosted by <strong>Cloudflare, Inc.</strong> (101 Townsend St, San Francisco, CA 94107, USA).
        Cloudflare is certified under the EU-US Data Privacy Framework (EU Commission adequacy decision per Art. 45 GDPR).
        Standard Contractual Clauses (SCCs) are additionally in place.
      </p>
      <p>
        When visiting the website, the hosting provider automatically collects server log data
        (IP address, browser type, OS, referrer URL, timestamp). Legal basis: Art. 6(1)(f) GDPR (legitimate interest).
      </p>
      <p>
        In addition, we temporarily process server-side visit events for operational monitoring and internal live
        notifications when pages of this website are opened. These events may include the requested path, timestamp,
        country and city derived from Cloudflare geo data, referrer, a shortened user agent string, and a pseudonymous
        visitor identifier generated from the IP address and a secret salt. We do not store the plain IP address in
        this live log ourselves. Retention for these visit events is generally about one hour. Legal basis:
        Art. 6(1)(f) GDPR (legitimate interest in secure operation, abuse detection, and awareness of current website
        activity).
      </p>

      <h3>4. User Accounts and Payment Processing</h3>
      <p>When you create an account or use paid services (e.g., API credits), we process:</p>
      <ul>
        <li><strong>Account data:</strong> Email address, display name — Legal basis: Contract performance (Art. 6(1)(b) GDPR)</li>
        <li><strong>Payment data:</strong> Processed directly by <strong>Stripe, Inc.</strong> (South San Francisco, CA, USA). Stripe is certified under the EU-US Data Privacy Framework. We do not store credit card numbers or bank details. Legal basis: Contract performance (Art. 6(1)(b) GDPR)</li>
        <li><strong>Usage data:</strong> Credit balance, usage history — Legal basis: Contract performance (Art. 6(1)(b) GDPR)</li>
        <li><strong>Billing data:</strong> Retained for 10 years per German tax law (§ 147 AO, § 257 HGB) — Legal basis: Legal obligation (Art. 6(1)(c) GDPR)</li>
      </ul>

      <h3>5. Local Data Processing</h3>
      <p>
        MasterSelects stores project data, settings, and media references in your browser's IndexedDB.
        This data does not leave your computer and is not transmitted to us. AI features requiring an
        API connection are explicitly labeled as such.
      </p>

      <h3>6. Your Rights</h3>
      <p>You have the right to:</p>
      <ul>
        <li><strong>Access</strong> (Art. 15 GDPR) — What data we store about you</li>
        <li><strong>Rectification</strong> (Art. 16 GDPR) — Correction of inaccurate data</li>
        <li><strong>Erasure</strong> (Art. 17 GDPR) — Deletion of your data ("right to be forgotten")</li>
        <li><strong>Restriction</strong> (Art. 18 GDPR) — Restriction of processing</li>
        <li><strong>Data portability</strong> (Art. 20 GDPR) — Your data in machine-readable format</li>
        <li><strong>Objection</strong> (Art. 21 GDPR) — Object to processing</li>
      </ul>
      <p>To exercise your rights, email <strong>admin@masterselects.com</strong>.</p>
      <p>You have the right to lodge a complaint with a data protection supervisory authority.</p>

      <h3>7. Cookies</h3>
      <p>
        MasterSelects uses only technically necessary cookies for authentication and session management.
        No tracking or marketing cookies are used. The server-side visit monitoring described above does not store
        information on your device for this purpose and does not use marketing cookies. A cookie banner is therefore
        not required for this specific functionality.
      </p>

      <h3>8. Changes</h3>
      <p>This privacy policy is updated as needed. The current version is always available in the app under Info → Privacy.</p>
      <p className="legal-meta">Last updated: March 2026</p>
    </div>
  );
}

function ContactEN() {
  return (
    <div className="legal-text">
      <h3>Contact</h3>
      <p>For questions, suggestions, or issues:</p>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">Email</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">Issues</span>
          <a href="https://github.com/Sportinger/MasterSelects/issues" target="_blank" rel="noopener noreferrer">Bug Reports & Feature Requests</a>
        </div>
      </div>
      <h3>Privacy Requests</h3>
      <p>For data access, deletion, or other GDPR rights, email <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> with subject "Privacy Request".</p>
      <h3>Bug Reports</h3>
      <p>Please report technical issues via <a href="https://github.com/Sportinger/MasterSelects/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a> so other users can benefit from the solution.</p>
    </div>
  );
}

// =====================================================
// DEUTSCH
// =====================================================

function ImprintDE() {
  return (
    <div className="legal-text">
      <h3>Angaben gemäß § 5 TMG</h3>
      <p>Roman Kuskowski<br />[Adresse wird nachgetragen]</p>

      <h3>Kontakt</h3>
      <p>E-Mail: admin@masterselects.com</p>

      <h3>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h3>
      <p>Roman Kuskowski<br />[Adresse wird nachgetragen]</p>

      <h3>EU-Streitschlichtung</h3>
      <p>
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>
      </p>

      <h3>Haftungsausschluss</h3>
      <h4>Haftung für Inhalte</h4>
      <p>
        Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit
        und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen. Als Diensteanbieter sind wir
        gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich.
        Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder
        gespeicherte fremde Informationen zu überwachen.
      </p>
      <h4>Haftung für Links</h4>
      <p>
        Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben.
        Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber verantwortlich.
      </p>
      <h4>Urheberrecht</h4>
      <p>
        MasterSelects ist Open Source Software, veröffentlicht auf GitHub unter{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">github.com/Sportinger/MasterSelects</a>.
      </p>
    </div>
  );
}

function PrivacyDE() {
  return (
    <div className="legal-text">
      <h3>1. Datenschutz auf einen Blick</h3>
      <h4>Allgemeine Hinweise</h4>
      <p>
        Die folgenden Hinweise geben einen Überblick darüber, was mit Ihren personenbezogenen Daten passiert,
        wenn Sie MasterSelects nutzen.
      </p>
      <h4>Datenverarbeitung auf dieser Website</h4>
      <p>
        <strong>MasterSelects ist primär eine lokale Anwendung.</strong> Alle Video-, Bild- und Audiodateien
        werden ausschließlich auf Ihrem Gerät verarbeitet. Ihre Mediendateien verlassen zu keinem Zeitpunkt Ihren Computer.
      </p>

      <h3>2. Verantwortlicher</h3>
      <p>Roman Kuskowski<br />E-Mail: admin@masterselects.com</p>

      <h3>3. Hosting</h3>
      <p>
        Diese Website wird bei <strong>Cloudflare, Inc.</strong> (101 Townsend St, San Francisco, CA 94107, USA) gehostet.
        Cloudflare ist unter dem EU-US Data Privacy Framework zertifiziert (Angemessenheitsbeschluss der
        EU-Kommission gem. Art. 45 DSGVO). Ergänzend bestehen Standardvertragsklauseln (SCCs).
      </p>
      <p>
        Beim Besuch der Website werden automatisch vom Hosting-Provider Informationen in sog. Server-Log-Dateien
        gespeichert (IP-Adresse, Browsertyp, Betriebssystem, Referrer-URL, Uhrzeit). Rechtsgrundlage ist
        Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der sicheren Bereitstellung).
      </p>

      <p>
        Zus&auml;tzlich verarbeiten wir vor&uuml;bergehend serverseitige Besuchsereignisse f&uuml;r die technische
        Betriebs&uuml;berwachung und interne Live-Benachrichtigungen, wenn Seiten dieser Website aufgerufen werden.
        Dabei k&ouml;nnen insbesondere der aufgerufene Pfad, der Zeitpunkt, Land und Stadt aus den Cloudflare-Geo-Daten,
        Referrer, ein gek&uuml;rzter User-Agent sowie eine pseudonyme Besucherkennung verarbeitet werden, die aus der
        IP-Adresse und einem geheimen Salt gebildet wird. Die Klar-IP speichern wir in diesem Live-Log selbst nicht.
        Die Speicherdauer dieser Besuchsereignisse betr&auml;gt in der Regel etwa eine Stunde. Rechtsgrundlage ist
        Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an sicherem Betrieb, Missbrauchserkennung und Kenntnis
        aktueller Website-Aktivit&auml;ten).
      </p>

      <h3>4. Benutzerkonten und Zahlungsabwicklung</h3>
      <p>Wenn Sie ein Benutzerkonto erstellen oder kostenpflichtige Dienste (z.B. API-Credits) nutzen, verarbeiten wir:</p>
      <ul>
        <li><strong>Kontodaten:</strong> E-Mail-Adresse, Anzeigename — Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO)</li>
        <li><strong>Zahlungsdaten:</strong> Werden direkt von <strong>Stripe, Inc.</strong> verarbeitet. Stripe ist unter dem EU-US Data Privacy Framework zertifiziert. Wir speichern keine Kreditkartennummern oder Bankdaten. Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO)</li>
        <li><strong>Nutzungsdaten:</strong> Credit-Balance, Nutzungshistorie — Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO)</li>
        <li><strong>Rechnungsdaten:</strong> Werden gem. § 147 AO und § 257 HGB für 10 Jahre aufbewahrt — Rechtsgrundlage: Gesetzliche Pflicht (Art. 6 Abs. 1 lit. c DSGVO)</li>
      </ul>

      <h3>5. Lokale Datenverarbeitung</h3>
      <p>
        MasterSelects speichert Projektdaten, Einstellungen und Medien-Referenzen in der IndexedDB Ihres Browsers.
        Diese Daten verlassen Ihren Computer nicht. AI-Funktionen mit API-Verbindung werden explizit gekennzeichnet.
      </p>

      <h3>6. Ihre Rechte</h3>
      <p>Sie haben jederzeit das Recht auf:</p>
      <ul>
        <li><strong>Auskunft</strong> (Art. 15 DSGVO)</li>
        <li><strong>Berichtigung</strong> (Art. 16 DSGVO)</li>
        <li><strong>Löschung</strong> (Art. 17 DSGVO)</li>
        <li><strong>Einschränkung</strong> (Art. 18 DSGVO)</li>
        <li><strong>Datenübertragbarkeit</strong> (Art. 20 DSGVO)</li>
        <li><strong>Widerspruch</strong> (Art. 21 DSGVO)</li>
      </ul>
      <p>Zur Ausübung Ihrer Rechte genügt eine E-Mail an <strong>admin@masterselects.com</strong>.</p>

      <h3>7. Cookies</h3>
      <p>
        MasterSelects verwendet ausschließlich technisch notwendige Cookies für Authentifizierung und
        Session-Management. Keine Tracking- oder Marketing-Cookies. Die oben beschriebene serverseitige
        Besuchsüberwachung speichert für diesen Zweck keine Informationen auf Ihrem Endgerät.
      </p>

      <h3>8. Änderungen</h3>
      <p>Diese Datenschutzerklärung wird bei Bedarf angepasst. Aktuelle Version unter Info → Datenschutz.</p>
      <p className="legal-meta">Stand: März 2026</p>
    </div>
  );
}

function ContactDE() {
  return (
    <div className="legal-text">
      <h3>Kontakt</h3>
      <p>Bei Fragen, Anregungen oder Problemen:</p>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">E-Mail</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">Issues</span>
          <a href="https://github.com/Sportinger/MasterSelects/issues" target="_blank" rel="noopener noreferrer">Bug Reports & Feature Requests</a>
        </div>
      </div>
      <h3>Datenschutzanfragen</h3>
      <p>Für Auskünfte, Löschung oder andere DSGVO-Rechte: <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> mit Betreff "Datenschutzanfrage".</p>
      <h3>Bug Reports</h3>
      <p>Technische Probleme bitte über <a href="https://github.com/Sportinger/MasterSelects/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a> melden.</p>
    </div>
  );
}

// =====================================================
// FRANÇAIS
// =====================================================

function ImprintFR() {
  return (
    <div className="legal-text">
      <h3>Informations conformément au § 5 TMG (loi allemande sur les télémédias)</h3>
      <p>Roman Kuskowski<br />[Adresse à compléter]</p>
      <h3>Contact</h3>
      <p>Email : admin@masterselects.com</p>
      <h3>Responsable du contenu selon § 55 al. 2 RStV</h3>
      <p>Roman Kuskowski<br />[Adresse à compléter]</p>
      <h3>Règlement des litiges en ligne (UE)</h3>
      <p>
        La Commission européenne met à disposition une plateforme de règlement en ligne des litiges :{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>
      </p>
      <h3>Droit d'auteur</h3>
      <p>
        MasterSelects est un logiciel open source, publié sur{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </div>
  );
}

function PrivacyFR() {
  return (
    <div className="legal-text">
      <h3>1. Protection des données en bref</h3>
      <p>
        <strong>MasterSelects est principalement une application locale.</strong> Tous les fichiers vidéo, image et audio
        sont traités exclusivement sur votre appareil. Vos fichiers média ne quittent jamais votre ordinateur.
      </p>
      <h3>2. Responsable du traitement</h3>
      <p>Roman Kuskowski<br />Email : admin@masterselects.com</p>
      <h3>3. Hébergement</h3>
      <p>
        Ce site est hébergé par <strong>Cloudflare, Inc.</strong> (USA), certifié EU-US Data Privacy Framework.
        Des clauses contractuelles types (CCT) sont également en place.
      </p>
      <p>
        En outre, nous traitons temporairement des &eacute;v&eacute;nements de visite c&ocirc;t&eacute; serveur pour la
        surveillance technique de l&apos;exploitation et pour des notifications internes en direct lorsqu&apos;une page
        de ce site est ouverte. Ces donn&eacute;es peuvent inclure le chemin demand&eacute;, l&apos;horodatage, le pays
        et la ville d&eacute;duits des donn&eacute;es g&eacute;ographiques de Cloudflare, le referer, un agent utilisateur
        raccourci ainsi qu&apos;un identifiant visiteur pseudonymis&eacute; g&eacute;n&eacute;r&eacute; &agrave; partir de
        l&apos;adresse IP et d&apos;un sel secret. Nous ne conservons pas l&apos;adresse IP en clair dans ce journal
        interne. La dur&eacute;e de conservation est g&eacute;n&eacute;ralement d&apos;environ une heure. Base juridique :
        art. 6(1)(f) RGPD (int&eacute;r&ecirc;t l&eacute;gitime &agrave; la s&eacute;curit&eacute; du service, &agrave; la
        d&eacute;tection des abus et &agrave; la connaissance de l&apos;activit&eacute; actuelle du site).
      </p>
      <h3>4. Comptes utilisateurs et paiements</h3>
      <p>Les paiements sont traités par <strong>Stripe, Inc.</strong> (certifié EU-US DPF). Nous ne stockons aucune donnée de carte bancaire.</p>
      <h3>5. Vos droits (RGPD)</h3>
      <ul>
        <li>Accès (Art. 15), Rectification (Art. 16), Effacement (Art. 17)</li>
        <li>Limitation (Art. 18), Portabilité (Art. 20), Opposition (Art. 21)</li>
      </ul>
      <p>Contact : <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookies</h3>
      <p>
        Uniquement des cookies techniques nécessaires. Pas de cookies de suivi ou marketing. La surveillance de visite
        décrite ci-dessus ne stocke pas d&apos;information sur votre terminal à cette fin.
      </p>
      <p className="legal-meta">Dernière mise à jour : mars 2026</p>
    </div>
  );
}

function ContactFR() {
  return (
    <div className="legal-text">
      <h3>Contact</h3>
      <p>Pour toute question ou suggestion :</p>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">Email</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
      </div>
      <h3>Demandes de confidentialité</h3>
      <p>Pour exercer vos droits RGPD : <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> avec l'objet "Demande de confidentialité".</p>
    </div>
  );
}

// =====================================================
// ESPAÑOL
// =====================================================

function ImprintES() {
  return (
    <div className="legal-text">
      <h3>Información según § 5 TMG (Ley alemana de telemedios)</h3>
      <p>Roman Kuskowski<br />[Dirección pendiente]</p>
      <h3>Contacto</h3>
      <p>Email: admin@masterselects.com</p>
      <h3>Responsable del contenido según § 55 Abs. 2 RStV</h3>
      <p>Roman Kuskowski<br />[Dirección pendiente]</p>
      <h3>Resolución de disputas en línea (UE)</h3>
      <p>
        La Comisión Europea proporciona una plataforma para la resolución de disputas en línea:{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>
      </p>
      <h3>Derechos de autor</h3>
      <p>
        MasterSelects es software de código abierto, publicado en{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </div>
  );
}

function PrivacyES() {
  return (
    <div className="legal-text">
      <h3>1. Privacidad en resumen</h3>
      <p>
        <strong>MasterSelects es principalmente una aplicación local.</strong> Todos los archivos se procesan
        exclusivamente en su dispositivo. Sus archivos multimedia nunca salen de su ordenador.
      </p>
      <h3>2. Responsable del tratamiento</h3>
      <p>Roman Kuskowski<br />Email: admin@masterselects.com</p>
      <h3>3. Alojamiento</h3>
      <p>Alojado por <strong>Cloudflare, Inc.</strong> (EE.UU.), certificado EU-US Data Privacy Framework. Se aplican cláusulas contractuales tipo (CCT).</p>
      <p>
        Adem&aacute;s, procesamos temporalmente eventos de visita en el servidor para la supervisi&oacute;n t&eacute;cnica
        del servicio y para notificaciones internas en tiempo real cuando se abre una p&aacute;gina de este sitio web.
        Estos eventos pueden incluir la ruta solicitada, la marca temporal, el pa&iacute;s y la ciudad derivados de los
        datos geogr&aacute;ficos de Cloudflare, el referer, una cadena abreviada del agente de usuario y un identificador
        seudonimizado del visitante generado a partir de la direcci&oacute;n IP y un valor secreto. No almacenamos la IP
        en texto claro en este registro interno. El plazo de conservaci&oacute;n suele ser de aproximadamente una hora.
        Base jur&iacute;dica: art. 6(1)(f) RGPD (inter&eacute;s leg&iacute;timo en el funcionamiento seguro, la detecci&oacute;n
        de abusos y el conocimiento de la actividad actual del sitio).
      </p>
      <h3>4. Cuentas y pagos</h3>
      <p>Los pagos son procesados por <strong>Stripe, Inc.</strong> (certificado EU-US DPF). No almacenamos datos de tarjetas.</p>
      <h3>5. Sus derechos (RGPD)</h3>
      <ul>
        <li>Acceso (Art. 15), Rectificación (Art. 16), Supresión (Art. 17)</li>
        <li>Limitación (Art. 18), Portabilidad (Art. 20), Oposición (Art. 21)</li>
      </ul>
      <p>Contacto: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookies</h3>
      <p>
        Solo cookies técnicamente necesarias. Sin cookies de seguimiento o marketing. La supervisión de visitas
        descrita arriba no almacena información en su dispositivo con esta finalidad.
      </p>
      <p className="legal-meta">Última actualización: marzo 2026</p>
    </div>
  );
}

function ContactES() {
  return (
    <div className="legal-text">
      <h3>Contacto</h3>
      <p>Para preguntas o sugerencias:</p>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">Email</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
      </div>
      <h3>Solicitudes de privacidad</h3>
      <p>Para ejercer sus derechos RGPD: <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> con asunto "Solicitud de privacidad".</p>
    </div>
  );
}

// =====================================================
// PORTUGUÊS
// =====================================================

function ImprintPT() {
  return (
    <div className="legal-text">
      <h3>Informações conforme § 5 TMG (Lei alemã de telemídia)</h3>
      <p>Roman Kuskowski<br />[Endereço a ser adicionado]</p>
      <h3>Contato</h3>
      <p>Email: admin@masterselects.com</p>
      <h3>Direitos autorais</h3>
      <p>
        MasterSelects é software de código aberto, publicado no{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </div>
  );
}

function PrivacyPT() {
  return (
    <div className="legal-text">
      <h3>1. Privacidade em resumo</h3>
      <p>
        <strong>MasterSelects é principalmente um aplicativo local.</strong> Todos os arquivos são processados
        exclusivamente no seu dispositivo. Seus arquivos de mídia nunca saem do seu computador.
      </p>
      <h3>2. Controlador de dados</h3>
      <p>Roman Kuskowski<br />Email: admin@masterselects.com</p>
      <h3>3. Hospedagem</h3>
      <p>Hospedado pela <strong>Cloudflare, Inc.</strong> (EUA), certificada pelo EU-US Data Privacy Framework.</p>
      <p>
        Al&eacute;m disso, processamos temporariamente eventos de visita no servidor para monitoramento t&eacute;cnico
        da opera&ccedil;&atilde;o e para notifica&ccedil;&otilde;es internas em tempo real quando uma p&aacute;gina deste
        site &eacute; aberta. Esses eventos podem incluir o caminho solicitado, o hor&aacute;rio, pa&iacute;s e cidade
        derivados dos dados geogr&aacute;ficos da Cloudflare, referer, um user agent abreviado e um identificador
        pseudonimizado do visitante gerado a partir do endere&ccedil;o IP e de um valor secreto. N&atilde;o armazenamos o
        IP em texto puro nesse log interno. O prazo de reten&ccedil;&atilde;o normalmente &eacute; de cerca de uma hora.
        Base legal: art. 6(1)(f) do RGPD (interesse leg&iacute;timo na opera&ccedil;&atilde;o segura, detec&ccedil;&atilde;o
        de abuso e conhecimento da atividade atual do site).
      </p>
      <h3>4. Pagamentos</h3>
      <p>Processados pelo <strong>Stripe, Inc.</strong> (certificado EU-US DPF). Não armazenamos dados de cartão.</p>
      <h3>5. Seus direitos (RGPD)</h3>
      <ul>
        <li>Acesso (Art. 15), Retificação (Art. 16), Eliminação (Art. 17)</li>
        <li>Limitação (Art. 18), Portabilidade (Art. 20), Oposição (Art. 21)</li>
      </ul>
      <p>Contato: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookies</h3>
      <p>
        Apenas cookies tecnicamente necessários. Nenhum cookie de rastreamento ou marketing. O monitoramento de
        visitas descrito acima não armazena informações no seu dispositivo para essa finalidade.
      </p>
      <p className="legal-meta">Última atualização: março 2026</p>
    </div>
  );
}

function ContactPT() {
  return (
    <div className="legal-text">
      <h3>Contato</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">Email</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// 日本語
// =====================================================

function ImprintJA() {
  return (
    <div className="legal-text">
      <h3>運営者情報（ドイツ電気通信メディア法 § 5 TMG に基づく）</h3>
      <p>Roman Kuskowski<br />[住所は後日追記]</p>
      <h3>連絡先</h3>
      <p>メール: admin@masterselects.com</p>
      <h3>著作権</h3>
      <p>
        MasterSelects はオープンソースソフトウェアです。{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a> で公開されています。
      </p>
    </div>
  );
}

function PrivacyJA() {
  return (
    <div className="legal-text">
      <h3>1. プライバシーの概要</h3>
      <p>
        <strong>MasterSelects は主にローカルアプリケーションです。</strong>すべてのビデオ、画像、音声ファイルはお使いのデバイス上でのみ処理されます。メディアファイルがコンピュータから外部に送信されることはありません。
      </p>
      <h3>2. データ管理者</h3>
      <p>Roman Kuskowski<br />メール: admin@masterselects.com</p>
      <h3>3. ホスティング</h3>
      <p><strong>Cloudflare, Inc.</strong>（米国）でホスティング。EU-US データプライバシーフレームワーク認定済み。</p>
      <p>
        さらに、本サイトのページが開かれた際、技術的な運用監視と内部向けライブ通知のために、サーバー側で訪問イベントを一時的に処理します。これには、リクエストされたパス、時刻、Cloudflare の地理データから得られる国と都市、リファラー、短縮された
        User-Agent、ならびに IP アドレスと秘密のソルトから生成される仮名化された訪問者 ID が含まれる場合があります。この内部ログに IP アドレスそのものは保存しません。保存期間は通常およそ 1 時間です。法的根拠は GDPR 第 6 条第 1 項
        f 号（安全な運用、不正利用の検知、現在のサイト活動の把握に関する正当な利益）です。
      </p>
      <h3>4. 決済</h3>
      <p><strong>Stripe, Inc.</strong> が決済を処理します。クレジットカード情報は保存しません。</p>
      <h3>5. あなたの権利（GDPR）</h3>
      <ul>
        <li>アクセス権（第15条）、訂正権（第16条）、消去権（第17条）</li>
        <li>制限権（第18条）、データポータビリティ（第20条）、異議申立権（第21条）</li>
      </ul>
      <p>連絡先: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookie</h3>
      <p>
        認証とセッション管理のための技術的に必要な Cookie のみを使用します。トラッキング Cookie やマーケティング Cookie は使用しません。上記の訪問監視は、この目的でお使いの端末に情報を保存しません。
      </p>
      <p className="legal-meta">最終更新: 2026年3月</p>
    </div>
  );
}

function ContactJA() {
  return (
    <div className="legal-text">
      <h3>お問い合わせ</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">メール</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// 한국어
// =====================================================

function ImprintKO() {
  return (
    <div className="legal-text">
      <h3>운영자 정보 (독일 텔레미디어법 § 5 TMG)</h3>
      <p>Roman Kuskowski<br />[주소 추후 추가]</p>
      <h3>연락처</h3>
      <p>이메일: admin@masterselects.com</p>
      <h3>저작권</h3>
      <p>
        MasterSelects는 오픈소스 소프트웨어입니다.{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>에서 확인하세요.
      </p>
    </div>
  );
}

function PrivacyKO() {
  return (
    <div className="legal-text">
      <h3>1. 개인정보 처리 개요</h3>
      <p>
        <strong>MasterSelects는 주로 로컬 애플리케이션입니다.</strong> 모든 비디오, 이미지, 오디오 파일은 사용자의 기기에서만 처리됩니다. 미디어 파일은 절대 컴퓨터 밖으로 전송되지 않습니다.
      </p>
      <h3>2. 데이터 관리자</h3>
      <p>Roman Kuskowski<br />이메일: admin@masterselects.com</p>
      <h3>3. 호스팅</h3>
      <p><strong>Cloudflare, Inc.</strong>(미국)에서 호스팅. EU-US 데이터 프라이버시 프레임워크 인증.</p>
      <p>
        또한 이 사이트의 페이지가 열릴 때 기술 운영 모니터링과 내부 실시간 알림을 위해 서버 측 방문 이벤트를 일시적으로 처리합니다. 여기에는 요청된 경로, 시각, Cloudflare 지리 데이터에서 도출된 국가 및 도시, referer, 축약된 user agent, 그리고 IP 주소와 비밀
        salt 값을 기반으로 생성된 가명화된 방문자 ID가 포함될 수 있습니다. 이 내부 로그에 원본 IP 주소 자체를 저장하지는 않습니다. 보관 기간은 일반적으로 약 1시간입니다. 법적 근거는 GDPR 제6조 제1항 (f)호, 즉 안전한 운영, 남용 탐지 및 현재 사이트 활동 파악에
        대한 정당한 이익입니다.
      </p>
      <h3>4. 결제</h3>
      <p><strong>Stripe, Inc.</strong>가 결제를 처리합니다. 신용카드 정보는 저장하지 않습니다.</p>
      <h3>5. 귀하의 권리 (GDPR)</h3>
      <ul>
        <li>열람권 (제15조), 정정권 (제16조), 삭제권 (제17조)</li>
        <li>처리제한권 (제18조), 이동권 (제20조), 반대권 (제21조)</li>
      </ul>
      <p>연락처: <strong>admin@masterselects.com</strong></p>
      <h3>6. 쿠키</h3>
      <p>
        인증과 세션 관리를 위한 기술적으로 필요한 쿠키만 사용합니다. 추적 또는 마케팅 쿠키는 사용하지 않습니다. 위에서 설명한 방문 모니터링은 이 목적을 위해 사용자 단말기에 정보를 저장하지 않습니다.
      </p>
      <p className="legal-meta">최종 업데이트: 2026년 3월</p>
    </div>
  );
}

function ContactKO() {
  return (
    <div className="legal-text">
      <h3>연락처</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">이메일</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// 中文
// =====================================================

function ImprintZH() {
  return (
    <div className="legal-text">
      <h3>运营者信息（根据德国电信媒体法 § 5 TMG）</h3>
      <p>Roman Kuskowski<br />[地址待补充]</p>
      <h3>联系方式</h3>
      <p>电子邮件: admin@masterselects.com</p>
      <h3>版权</h3>
      <p>
        MasterSelects 是开源软件，发布在{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>。
      </p>
    </div>
  );
}

function PrivacyZH() {
  return (
    <div className="legal-text">
      <h3>1. 隐私概览</h3>
      <p>
        <strong>MasterSelects 主要是一个本地应用程序。</strong>所有视频、图片和音频文件仅在您的设备上处理。您的媒体文件永远不会离开您的计算机。
      </p>
      <h3>2. 数据控制者</h3>
      <p>Roman Kuskowski<br />电子邮件: admin@masterselects.com</p>
      <h3>3. 托管</h3>
      <p>由 <strong>Cloudflare, Inc.</strong>（美国）托管，已获 EU-US 数据隐私框架认证。</p>
      <p>
        此外，当您打开本网站页面时，我们会临时在服务器端处理访问事件，用于技术运行监控和内部实时提醒。这些事件可能包括访问路径、时间戳、基于 Cloudflare 地理数据得出的国家和城市、referer、缩短后的 user agent，以及基于 IP 地址和秘密盐值
        生成的匿名化访客标识。我们不会在该内部日志中保存明文 IP 地址。此类访问事件通常仅保存约一小时。法律依据为 GDPR 第 6 条第 1 款 (f) 项，即我们对安全运行、滥用检测以及了解当前网站活动所具有的正当利益。
      </p>
      <h3>4. 支付</h3>
      <p>由 <strong>Stripe, Inc.</strong> 处理支付。我们不存储信用卡信息。</p>
      <h3>5. 您的权利（GDPR）</h3>
      <ul>
        <li>访问权（第15条）、更正权（第16条）、删除权（第17条）</li>
        <li>限制处理权（第18条）、数据可携权（第20条）、反对权（第21条）</li>
      </ul>
      <p>联系方式: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookie</h3>
      <p>
        我们仅使用身份验证和会话管理所必需的技术性 Cookie，不使用跟踪或营销 Cookie。上述访问监控不会为此目的在您的设备上存储信息。
      </p>
      <p className="legal-meta">最后更新: 2026年3月</p>
    </div>
  );
}

function ContactZH() {
  return (
    <div className="legal-text">
      <h3>联系方式</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">电子邮件</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
      </div>
    </div>
  );
}

export type { LegalPage };

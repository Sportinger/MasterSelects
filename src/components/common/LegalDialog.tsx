// LegalDialog - Impressum, Datenschutz, Kontakt

import { useState, useEffect, useCallback } from 'react';

type LegalPage = 'impressum' | 'datenschutz' | 'kontakt';

interface LegalDialogProps {
  onClose: () => void;
  initialPage?: LegalPage;
}

export function LegalDialog({ onClose, initialPage = 'impressum' }: LegalDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [page, setPage] = useState<LegalPage>(initialPage);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [onClose, isClosing]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  return (
    <div
      className={`auth-billing-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="auth-billing-dialog auth-billing-dialog-wide">
        {/* Header */}
        <div className="auth-billing-header">
          <div>
            <div className="auth-billing-kicker">Legal</div>
            <h2>{page === 'impressum' ? 'Impressum' : page === 'datenschutz' ? 'Datenschutzerklärung' : 'Kontakt'}</h2>
          </div>
          <button className="auth-billing-close" onClick={handleClose}>✕</button>
        </div>

        {/* Tab Navigation */}
        <div className="legal-tabs">
          <button
            className={`legal-tab ${page === 'impressum' ? 'active' : ''}`}
            onClick={() => setPage('impressum')}
          >
            Impressum
          </button>
          <button
            className={`legal-tab ${page === 'datenschutz' ? 'active' : ''}`}
            onClick={() => setPage('datenschutz')}
          >
            Datenschutz
          </button>
          <button
            className={`legal-tab ${page === 'kontakt' ? 'active' : ''}`}
            onClick={() => setPage('kontakt')}
          >
            Kontakt
          </button>
        </div>

        {/* Content */}
        <div className="legal-content">
          {page === 'impressum' && <ImpressumContent />}
          {page === 'datenschutz' && <DatenschutzContent />}
          {page === 'kontakt' && <KontaktContent />}
        </div>
      </div>
    </div>
  );
}

function ImpressumContent() {
  return (
    <div className="legal-text">
      <h3>Angaben gemäß § 5 TMG</h3>
      <p>
        Julian Sportinger<br />
        {/* TODO: Adresse eintragen */}
        [Adresse wird nachgetragen]
      </p>

      <h3>Kontakt</h3>
      <p>
        E-Mail: admin@masterselects.com
      </p>

      <h3>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h3>
      <p>
        Julian Sportinger<br />
        [Adresse wird nachgetragen]
      </p>

      <h3>EU-Streitschlichtung</h3>
      <p>
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
          https://ec.europa.eu/consumers/odr/
        </a>
        <br />
        Unsere E-Mail-Adresse finden Sie oben im Impressum.
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
        Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der
        verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
      </p>

      <h4>Urheberrecht</h4>
      <p>
        MasterSelects ist Open Source Software, veröffentlicht auf GitHub unter{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">
          github.com/Sportinger/MasterSelects
        </a>.
      </p>
    </div>
  );
}

function DatenschutzContent() {
  return (
    <div className="legal-text">
      <h3>1. Datenschutz auf einen Blick</h3>

      <h4>Allgemeine Hinweise</h4>
      <p>
        Die folgenden Hinweise geben einen Überblick darüber, was mit Ihren personenbezogenen Daten passiert,
        wenn Sie MasterSelects nutzen. Personenbezogene Daten sind alle Daten, mit denen Sie persönlich
        identifiziert werden können.
      </p>

      <h4>Datenverarbeitung auf dieser Website</h4>
      <p>
        <strong>MasterSelects ist primär eine lokale Anwendung.</strong> Alle Video-, Bild- und Audiodateien
        werden ausschließlich auf Ihrem Gerät verarbeitet. Ihre Mediendateien verlassen zu keinem Zeitpunkt
        Ihren Computer.
      </p>

      <h3>2. Verantwortlicher</h3>
      <p>
        Julian Sportinger<br />
        E-Mail: admin@masterselects.com
      </p>
      <p>
        Verantwortliche Stelle ist die natürliche Person, die allein oder gemeinsam mit anderen über die
        Zwecke und Mittel der Verarbeitung von personenbezogenen Daten entscheidet.
      </p>

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

      <h3>4. Benutzerkonten und Zahlungsabwicklung</h3>
      <p>
        Wenn Sie ein Benutzerkonto erstellen oder kostenpflichtige Dienste (z.B. API-Credits) nutzen,
        verarbeiten wir folgende Daten:
      </p>
      <ul>
        <li><strong>Kontodaten:</strong> E-Mail-Adresse, Anzeigename — Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO)</li>
        <li><strong>Zahlungsdaten:</strong> Werden direkt von <strong>Stripe, Inc.</strong> (354 Oyster Point Blvd, South San Francisco, CA 94080, USA) verarbeitet. Stripe ist unter dem EU-US Data Privacy Framework zertifiziert. Wir speichern keine Kreditkartennummern oder Bankdaten. Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO)</li>
        <li><strong>Nutzungsdaten:</strong> Credit-Balance, Nutzungshistorie — Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO)</li>
        <li><strong>Rechnungsdaten:</strong> Werden gem. § 147 AO und § 257 HGB für 10 Jahre aufbewahrt — Rechtsgrundlage: Gesetzliche Pflicht (Art. 6 Abs. 1 lit. c DSGVO)</li>
      </ul>

      <h3>5. Lokale Datenverarbeitung</h3>
      <p>
        MasterSelects speichert Projektdaten, Einstellungen und Medien-Referenzen in der IndexedDB Ihres Browsers.
        Diese Daten verlassen Ihren Computer nicht und werden nicht an uns übermittelt. AI-Funktionen, die
        eine API-Verbindung erfordern, werden explizit als solche gekennzeichnet.
      </p>

      <h3>6. Ihre Rechte</h3>
      <p>Sie haben jederzeit das Recht auf:</p>
      <ul>
        <li><strong>Auskunft</strong> (Art. 15 DSGVO) — Welche Daten wir über Sie gespeichert haben</li>
        <li><strong>Berichtigung</strong> (Art. 16 DSGVO) — Korrektur unrichtiger Daten</li>
        <li><strong>Löschung</strong> (Art. 17 DSGVO) — Löschung Ihrer Daten ("Recht auf Vergessenwerden")</li>
        <li><strong>Einschränkung</strong> (Art. 18 DSGVO) — Einschränkung der Verarbeitung</li>
        <li><strong>Datenübertragbarkeit</strong> (Art. 20 DSGVO) — Ihre Daten in maschinenlesbarem Format</li>
        <li><strong>Widerspruch</strong> (Art. 21 DSGVO) — Widerspruch gegen die Verarbeitung</li>
      </ul>
      <p>
        Zur Ausübung Ihrer Rechte genügt eine E-Mail an <strong>admin@masterselects.com</strong>.
      </p>
      <p>
        Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.
      </p>

      <h3>7. Cookies</h3>
      <p>
        MasterSelects verwendet ausschließlich technisch notwendige Cookies für Authentifizierung und
        Session-Management. Es werden keine Tracking- oder Marketing-Cookies eingesetzt.
        Ein Cookie-Banner ist daher nicht erforderlich.
      </p>

      <h3>8. Änderungen</h3>
      <p>
        Diese Datenschutzerklärung wird bei Bedarf angepasst. Die aktuelle Version finden Sie jederzeit
        in der Anwendung unter Info → Datenschutz.
      </p>

      <p className="legal-meta">Stand: März 2026</p>
    </div>
  );
}

function KontaktContent() {
  return (
    <div className="legal-text">
      <h3>Kontakt</h3>
      <p>
        Bei Fragen, Anregungen oder Problemen erreichen Sie uns unter:
      </p>

      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">E-Mail</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">
            Sportinger/MasterSelects
          </a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">Issues</span>
          <a href="https://github.com/Sportinger/MasterSelects/issues" target="_blank" rel="noopener noreferrer">
            Bug Reports & Feature Requests
          </a>
        </div>
      </div>

      <h3>Datenschutzanfragen</h3>
      <p>
        Für Auskünfte, Löschung oder andere Rechte nach DSGVO schreiben Sie bitte an{' '}
        <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> mit dem Betreff
        "Datenschutzanfrage".
      </p>

      <h3>Bug Reports</h3>
      <p>
        Technische Probleme melden Sie am besten über{' '}
        <a href="https://github.com/Sportinger/MasterSelects/issues" target="_blank" rel="noopener noreferrer">
          GitHub Issues
        </a>. So können andere Nutzer von der Lösung profitieren.
      </p>
    </div>
  );
}

export type { LegalPage };

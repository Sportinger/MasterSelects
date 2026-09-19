import { LegalContactMethods, LegalPostalAddress } from './LegalContactDetails';

// =====================================================
// DEUTSCH
// =====================================================

export function ImprintDE() {
  return (
    <div className="legal-text">
      <h3>Angaben gemäß § 5 DDG</h3>
      <p><LegalPostalAddress /></p>

      <h3>Kontakt</h3>
      <p><LegalContactMethods emailLabel="E-Mail" phoneLabel="Telefon" /></p>

      <h4>Urheberrecht</h4>
      <p>
        Der MasterSelects-Editor steht unter der GNU AGPL-3.0-only. Copyright © 2026 Jan Roman Kuskowski.
        Drittanbieter-Komponenten unterliegen ihren jeweiligen Lizenzen.
      </p>
    </div>
  );
}

export function PrivacyDE() {
  return (
    <div className="legal-text">
      <h3>1. Datenschutz auf einen Blick</h3>
      <p>
        <strong>MasterSelects arbeitet standardmäßig lokal.</strong> Projekte und Mediendateien werden im Browser
        verarbeitet. Abgesehen von der technisch erforderlichen Auslieferung der Website und den unten beschriebenen,
        datenschutzgesteuerten Produktanalysen verlassen Daten Ihr Gerät nur, wenn Sie eine ausdrücklich als Cloud-,
        Download-, Login-, Zahlungs- oder Anbieterfunktion gekennzeichnete Funktion aufrufen.
      </p>

      <h3>2. Verantwortlicher</h3>
      <p><LegalPostalAddress /><br /><LegalContactMethods emailLabel="E-Mail" phoneLabel="Telefon" /></p>

      <h3>3. Hosting und Website-Aufrufe</h3>
      <p>
        Diese Website wird bei <strong>Cloudflare, Inc.</strong> (101 Townsend St, San Francisco, CA 94107, USA) gehostet.
        Dabei verarbeitet Cloudflare insbesondere IP-Adresse, angefragte URL, Zeitpunkt, Referrer sowie Browser- und
        Geräteinformationen zur Auslieferung und Absicherung der Website. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO
        (sichere, zuverlässige Bereitstellung). Provider-Logs werden nach den vertraglichen und konfigurierten
        Aufbewahrungsfristen gelöscht, sobald sie für Betrieb und Sicherheit nicht mehr erforderlich sind.
      </p>
      <p>
        Zusätzlich speichern wir für Betriebsüberwachung und Missbrauchserkennung den Pfad, Zeitpunkt, das
        Cloudflare-Land, grobe Browser-, Betriebssystem- und Geräteklassen, die Referrer-Domain sowie eine täglich
        wechselnde pseudonyme Besucherkennung, die mittels HMAC aus IP-Adresse und geheimem Schlüssel gebildet wird.
        Stadt, vollständiger User-Agent, vollständige Referrer-URL und Klar-IP werden in diesem Live-Log nicht
        gespeichert; die Kennung erlaubt keine tageübergreifende Wiedererkennung. Die Ereignisse werden nach 180 Tagen
        automatisch gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.
      </p>

      <h3>4. Produktanalysen</h3>
      <p>
        Wir verarbeiten einen festen, selbst betriebenen Katalog grober Produktereignisse, etwa App-Aufruf, Setup- und
        Tutorial-Fortschritt, abgeschlossene Importe, Edit-Kategorien, Wiedergabe, geöffnete Panels, Checkout-Status und
        Exportergebnisse. Bei angemeldeten Personen können Ereignisse mit der internen Konto-ID verknüpft werden;
        anonyme Ereignisse verwenden nur eine flüchtige Sitzungs-ID im Arbeitsspeicher. Dateinamen, Pfade, Projekt- oder
        Timeline-Inhalte, Medien, Prompts, Chat- oder Transkripttexte, rohe Fehlermeldungen und eine dauerhafte
        Analyse-Gerätekennung werden nicht erfasst. Es wird kein Analyse-Cookie gesetzt. Produktereignisse werden nach
        180 Tagen automatisch gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Verbesserung von Bedienbarkeit,
        Zuverlässigkeit und Produktaktivierung). Sie können der Verarbeitung jederzeit unter Einstellungen &gt;
        Allgemein &gt; Datenschutz widersprechen; Do Not Track und Global Privacy Control werden ebenfalls beachtet.
      </p>

      <h3>5. Konten, Anmeldung, E-Mail und Zahlung</h3>
      <ul>
        <li><strong>Kontodaten:</strong> E-Mail-Adresse, Anzeigename, Credit-Bestand und Nutzungshistorie; Art. 6 Abs. 1 lit. b DSGVO.</li>
        <li><strong>Google-Anmeldung:</strong> Bei freiwilliger Google-Anmeldung erhalten wir die von Google freigegebenen Identitäts- und Kontaktdaten; Art. 6 Abs. 1 lit. b DSGVO.</li>
        <li><strong>Transaktions-E-Mails:</strong> <strong>Resend</strong> verarbeitet Empfängeradresse und Nachrichteninhalt für Login- und Kontomails; Art. 6 Abs. 1 lit. b DSGVO.</li>
        <li><strong>Zahlungen:</strong> <strong>Stripe, Inc.</strong> verarbeitet Zahlungs- und Abrechnungsdaten. Wir speichern keine vollständigen Karten- oder Bankdaten; Art. 6 Abs. 1 lit. b und lit. c DSGVO.</li>
        <li><strong>Vertragsnachweise:</strong> Bei kostenpflichtigen Verträgen protokollieren wir Zeitpunkt und Version der akzeptierten AGB und Widerrufsbelehrung sowie den Wunsch nach sofortigem Leistungsbeginn, senden die Vertragsbestätigung per E-Mail und speichern über die Formulare unter /widerruf und /kuendigen eingehende Erklärungen mit Name, E-Mail-Adresse, Vertragsreferenz und Eingangszeit; Art. 6 Abs. 1 lit. b und lit. c DSGVO, Aufbewahrung für die gesetzlichen Nachweis- und Verjährungsfristen.</li>
      </ul>
      <p>
        Login-Zustände laufen nach zehn Minuten, Sitzungen nach 30 Tagen ab. Konten und nicht gesetzlich
        aufbewahrungspflichtige Nutzungsdaten bleiben für die Vertragsdauer gespeichert und werden danach gelöscht,
        sobald keine Abrechnungs-, Sicherheits- oder Rechtsansprüche mehr bestehen. Rechnungen und Buchungsbelege werden
        grundsätzlich acht Jahre aufbewahrt (§ 147 AO, § 14b UStG).
      </p>

      <h3>6. Cloud- und KI-Funktionen</h3>
      <p>
        Wenn Sie eine Cloud- oder KI-Funktion starten, werden die dafür ausgewählten Prompts, Nachrichten, Medien,
        Referenzen und technischen Metadaten an den jeweiligen Anbieter übermittelt. Abhängig von der gewählten Funktion
        sind Empfänger insbesondere <strong>OpenAI</strong>, <strong>Kie.ai</strong> und dessen ausgewählte Modell- oder
        Upload-Anbieter sowie <strong>ElevenLabs</strong>. Zugangsdaten für KI-Anbieter werden von den
        MasterSelects-Diensten verwaltet und nicht im Browser gespeichert. Wenn Sie die optionale YouTube-Data-API-
        Integration konfigurieren, verbindet sich der Browser mit diesem Zugang direkt zu Google. Rechtsgrundlage ist
        Art. 6 Abs. 1 lit. b DSGVO; Sicherheits- und Missbrauchsprotokolle beruhen ergänzend auf Art. 6 Abs. 1 lit. f DSGVO.
      </p>
      <p>
        Beim gehosteten AI-Chat können Prompts, Antworten, Tool Calls, Moderationsergebnisse, Tokenzahlen, Credit-Kosten,
        Dauer, Status, Fehler und ein pseudonymer IP-Hash für Account-Historie, Abrechnung, Support und Missbrauchsschutz
        gespeichert werden. Diese Inhalte werden gelöscht, wenn sie hierfür nicht mehr erforderlich sind oder einem
        berechtigten Löschverlangen entsprochen wird; gesetzlich erforderliche Abrechnungsnachweise bleiben unberührt.
        Zum Schutz anonymer Willkommens-Credits werden zusätzlich nur mit geheimem Schlüssel erzeugte HMACs aus
        Verbindungs-IP und Browserkennung sowie ein reiner Netzwerk-HMAC gespeichert; Klar-IP und Browserkennung werden
        nicht in der Anspruchstabelle gespeichert.
      </p>

      <h3>7. Lokale Speicherung und externe Ressourcen</h3>
      <p>
        Projekte, Einstellungen, der optionale verschlüsselte YouTube-Data-API-Zugang und Medienreferenzen liegen in
        Local Storage, IndexedDB oder OPFS Ihres Browsers und können über die Browserdaten gelöscht werden. Wenn Sie ausdrücklich eine
        Google-Schrift auswählen oder ein KI-/Audio-Modell laden, verbindet sich Ihr Browser mit Google Fonts bzw.
        Hugging Face; dabei werden insbesondere IP-Adresse und angefragte Ressource übertragen. Wenn Sie Release-Infos
        des Native Helpers oder GitHub-Links öffnen, verbindet sich Ihr Browser mit GitHub. Das Demo-Video wird von
        MasterSelects selbst ausgeliefert und baut keine Verbindung zu YouTube auf.
      </p>

      <h3>8. Cookies und Endgerätespeicher</h3>
      <p>
        Wir verwenden keine Analyse- oder Marketing-Cookies. Technisch erforderliche Cookies sichern Login-Zustände
        (höchstens zehn Minuten), Account-Sitzungen und Gast-Sitzungen für gehostete KI (höchstens 30 Tage). Erst wenn Sie aktiv nach dem kostenlosen Credit-Angebot
        fragen, bindet ein notwendiger Cookie das angeforderte Angebot für höchstens eine Stunde an diesen Browser.
        Die serverseitige Besuchsüberwachung speichert dafür nichts auf Ihrem Endgerät.
      </p>

      <h3>9. Drittlandübermittlungen</h3>
      <p>
        Einige genannte Anbieter verarbeiten Daten außerhalb des Europäischen Wirtschaftsraums. Solche Übermittlungen
        erfolgen nur auf Grundlage eines Angemessenheitsbeschlusses nach Art. 45 DSGVO oder geeigneter Garantien nach
        Art. 46 DSGVO, insbesondere Standardvertragsklauseln. Informationen und Kopien der einschlägigen Garantien können
        Sie unter admin@masterselects.com anfordern.
      </p>

      <h3>10. Ihre Rechte</h3>
      <p>Sie haben jederzeit das Recht auf:</p>
      <ul>
        <li><strong>Auskunft</strong> (Art. 15 DSGVO)</li>
        <li><strong>Berichtigung</strong> (Art. 16 DSGVO)</li>
        <li><strong>Löschung</strong> (Art. 17 DSGVO)</li>
        <li><strong>Einschränkung</strong> (Art. 18 DSGVO)</li>
        <li><strong>Datenübertragbarkeit</strong> (Art. 20 DSGVO)</li>
        <li><strong>Widerspruch</strong> (Art. 21 DSGVO)</li>
        <li><strong>Widerruf einer Einwilligung</strong> mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO)</li>
      </ul>
      <p>Zur Ausübung Ihrer Rechte genügt eine E-Mail an <strong>admin@masterselects.com</strong>.</p>
      <p>Sie können sich außerdem bei einer Datenschutzaufsichtsbehörde beschweren (Art. 77 DSGVO).</p>

      <h3>11. Pflicht zur Bereitstellung</h3>
      <p>
        Die lokale Editor-Nutzung ist ohne Konto möglich. Für Konto, Zahlung oder Cloud-Credits sind die jeweils
        abgefragten Angaben vertraglich erforderlich; ohne sie kann die betreffende Funktion nicht bereitgestellt werden.
      </p>

      <h3>12. Änderungen</h3>
      <p>Die aktuelle Fassung ist jederzeit unter <a href="/datenschutz">/datenschutz</a> erreichbar.</p>
      <p className="legal-meta">Stand: 16. August 2026</p>
    </div>
  );
}

export function ContactDE() {
  return (
    <div className="legal-text">
      <h3>Kontakt</h3>
      <p>Bei Fragen, Anregungen oder Problemen:</p>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">E-Mail</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
      </div>
      <h3>Datenschutzanfragen</h3>
      <p>Für Auskünfte, Löschung oder andere DSGVO-Rechte: <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> mit Betreff "Datenschutzanfrage".</p>
      <h3>Bug Reports</h3>
      <p>Technische Probleme bitte an <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> melden.</p>
    </div>
  );
}

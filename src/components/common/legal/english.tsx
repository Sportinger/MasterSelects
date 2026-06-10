// =====================================================
// ENGLISH
// =====================================================

export function ImprintEN() {
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

export function PrivacyEN() {
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
        <li><strong>Hosted AI chat logs:</strong> When you use hosted AI chat, prompts/messages, assistant responses, tool calls, token counts, credit cost, duration, status, and error state may be stored in our D1 database for account history, billing/debugging, abuse handling, and support — Legal basis: Contract performance (Art. 6(1)(b) GDPR) and legitimate interest (Art. 6(1)(f) GDPR)</li>
        <li><strong>Billing data:</strong> Retained for 10 years per German tax law (§ 147 AO, § 257 HGB) — Legal basis: Legal obligation (Art. 6(1)(c) GDPR)</li>
      </ul>

      <h3>5. Local Data Processing</h3>
      <p>
        MasterSelects stores project data, settings, and media references in your browser's IndexedDB.
        This data does not leave your computer and is not transmitted to us. AI features requiring an
        API connection are explicitly labeled as such; hosted AI chat is processed on the Cloudflare backend
        and can be logged as described above.
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
      <p className="legal-meta">Last updated: May 2026</p>
    </div>
  );
}

export function ContactEN() {
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

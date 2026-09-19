import { LegalContactMethods, LegalPostalAddress } from './LegalContactDetails';

// =====================================================
// ENGLISH
// =====================================================

export function ImprintEN() {
  return (
    <div className="legal-text">
      <h3>Information according to § 5 DDG (German Digital Services Act)</h3>
      <p><LegalPostalAddress /></p>

      <h3>Contact</h3>
      <p><LegalContactMethods emailLabel="Email" phoneLabel="Phone" /></p>

      <h4>Copyright</h4>
      <p>
        The MasterSelects editor is licensed under GNU AGPL-3.0-only. Copyright © 2026 Jan Roman Kuskowski.
        Third-party components remain subject to their respective licenses.
      </p>
    </div>
  );
}

export function PrivacyEN() {
  return (
    <div className="legal-text">
      <h3>1. Privacy at a Glance</h3>
      <p>
        <strong>MasterSelects works locally by default.</strong> Projects and media are processed in your browser.
        Apart from the technically necessary delivery of the website and the privacy-controlled product analytics
        described below, data leaves your device only when you invoke a feature clearly identified as a cloud,
        download, login, payment, or provider feature.
      </p>

      <h3>2. Data Controller</h3>
      <p><LegalPostalAddress /><br /><LegalContactMethods emailLabel="Email" phoneLabel="Phone" /></p>

      <h3>3. Hosting and Website Requests</h3>
      <p>
        This website is hosted by <strong>Cloudflare, Inc.</strong> (101 Townsend St, San Francisco, CA 94107, USA).
        Cloudflare processes the IP address, requested URL, timestamp, referrer, and browser/device information to
        deliver and secure the site. Legal basis: Art. 6(1)(f) GDPR (secure and reliable delivery). Provider logs are
        erased under the contracted and configured retention rules once no longer needed for operations or security.
      </p>
      <p>
        For operational monitoring and abuse detection, we additionally store the path, timestamp, Cloudflare country,
        coarse browser, operating-system and device classes, the referrer domain, and a daily rotating pseudonymous
        visitor identifier produced from the IP address with a secret-key HMAC. The city, full user agent, full referrer
        URL, and plain IP are not stored in this live log, and the identifier cannot be linked across days. Events are
        automatically deleted after 180 days. Legal basis: Art. 6(1)(f) GDPR.
      </p>

      <h3>4. Product Analytics</h3>
      <p>
        We process a fixed, first-party allowlist of coarse product events such as app opening, setup and tutorial
        progress, completed imports, edit categories, playback, opened panels, checkout state, and export outcomes.
        Signed-in events may be linked to the internal account ID; anonymous events use an ephemeral in-memory session
        ID. We do not collect filenames, paths, project or timeline content, media, prompts, chat or transcript text,
        raw errors, or a persistent analytics device identifier. No analytics cookie is used. Product events are
        automatically erased after 180 days. Legal basis: Art. 6(1)(f) GDPR (improving usability, reliability, and
        product activation). You can object at any time under Settings &gt; General &gt; Privacy; Do Not Track and Global
        Privacy Control signals are also honored.
      </p>

      <h3>5. Accounts, Login, Email, and Payments</h3>
      <ul>
        <li><strong>Account data:</strong> Email, display name, credit balance, and usage history; Art. 6(1)(b) GDPR.</li>
        <li><strong>Google login:</strong> If selected, we receive the identity/contact data released by Google; Art. 6(1)(b) GDPR.</li>
        <li><strong>Transactional email:</strong> <strong>Resend</strong> processes recipient address and message content for login/account messages; Art. 6(1)(b) GDPR.</li>
        <li><strong>Payments:</strong> <strong>Stripe, Inc.</strong> processes payment and billing data. We do not store complete card or bank details; Art. 6(1)(b) and (c) GDPR.</li>
        <li><strong>Contract records:</strong> For paid contracts we log the time and version of the accepted Terms and Withdrawal Policy and the request for immediate performance, send the contract confirmation by email, and store notices submitted through the forms at /withdrawal and /cancel with name, email address, contract reference, and time of receipt; Art. 6(1)(b) and (c) GDPR, retained for the statutory evidence and limitation periods.</li>
      </ul>
      <p>
        Login states expire after ten minutes and sessions after 30 days. Accounts and non-statutory usage data are
        retained for the contract term and then erased when no billing, security, or legal claim requires them.
        Invoices and accounting records are generally retained for eight years (§ 147 AO, § 14b UStG).
      </p>

      <h3>6. Cloud and AI Features</h3>
      <p>
        When you start a cloud or AI feature, the selected prompts, messages, media, references, and technical metadata
        are sent to the relevant provider. Depending on the feature, recipients include <strong>OpenAI</strong>,
        <strong>Kie.ai</strong> and its selected model/upload providers, and <strong>ElevenLabs</strong>. AI provider
        credentials are managed by MasterSelects services and are not stored in the browser. If you configure the
        optional YouTube Data API integration, the browser connects directly to Google using that credential. Legal
        basis: Art. 6(1)(b) GDPR, supplemented by Art. 6(1)(f) GDPR for security and abuse prevention.
      </p>
      <p>
        Hosted AI chat may store prompts, responses, tool calls, moderation results, token counts, credit cost, duration,
        status, errors, and a pseudonymous IP hash for account history, billing, support, and abuse prevention. Content is
        erased when no longer needed for those purposes or after a valid erasure request, without affecting statutory
        billing records. Anonymous welcome-credit abuse protection also stores secret-key HMACs derived from the
        connecting IP and browser user-agent, plus an IP-only network HMAC; the plain IP and user-agent are not stored in
        the claim table.
      </p>

      <h3>7. Local Storage and External Resources</h3>
      <p>
        Projects, settings, the optional encrypted YouTube Data API credential, and media references are stored in
        Local Storage, IndexedDB, or OPFS and can be erased through browser data controls. If you explicitly select a Google font or download an
        AI/audio model, your browser connects to Google Fonts or Hugging Face and transmits the IP address and requested
        resource. If you open Native Helper release information or GitHub links, your browser connects to GitHub. The
        demo video is served by MasterSelects and makes no YouTube connection.
      </p>

      <h3>8. Cookies and Device Storage</h3>
      <p>
        We use no analytics or marketing cookies. Necessary cookies protect login states (up to ten minutes), account
        sessions, and guest hosted-AI sessions (up to 30 days). Only after you actively check the free-credit offer does a necessary cookie bind the
        requested offer to that browser for up to one hour. Server-side visit monitoring stores nothing on the device.
      </p>

      <h3>9. International Transfers</h3>
      <p>
        Some providers process data outside the European Economic Area. Transfers take place only under an Art. 45 GDPR
        adequacy decision or Art. 46 GDPR safeguards, particularly Standard Contractual Clauses. Information and copies
        of relevant safeguards can be requested at admin@masterselects.com.
      </p>

      <h3>10. Your Rights</h3>
      <p>You have the right to:</p>
      <ul>
        <li><strong>Access</strong> (Art. 15 GDPR) — What data we store about you</li>
        <li><strong>Rectification</strong> (Art. 16 GDPR) — Correction of inaccurate data</li>
        <li><strong>Erasure</strong> (Art. 17 GDPR) — Deletion of your data ("right to be forgotten")</li>
        <li><strong>Restriction</strong> (Art. 18 GDPR) — Restriction of processing</li>
        <li><strong>Data portability</strong> (Art. 20 GDPR) — Your data in machine-readable format</li>
        <li><strong>Objection</strong> (Art. 21 GDPR) — Object to processing</li>
        <li><strong>Withdraw consent</strong> prospectively (Art. 7(3) GDPR)</li>
      </ul>
      <p>To exercise your rights, email <strong>admin@masterselects.com</strong>.</p>
      <p>You have the right to lodge a complaint with a data protection supervisory authority.</p>

      <h3>11. Required Data</h3>
      <p>
        The local editor can be used without an account. Account, payment, and cloud-credit data is contractually
        required for the relevant feature; without it, that feature cannot be provided.
      </p>

      <h3>12. Changes</h3>
      <p>The current version is always available at <a href="/privacy">/privacy</a>.</p>
      <p className="legal-meta">Last updated: August 16, 2026</p>
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
      </div>
      <h3>Privacy Requests</h3>
      <p>For data access, deletion, or other GDPR rights, email <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> with subject "Privacy Request".</p>
      <h3>Bug Reports</h3>
      <p>Please report technical issues to <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>.</p>
    </div>
  );
}

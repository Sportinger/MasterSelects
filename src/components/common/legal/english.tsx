// =====================================================
// ENGLISH
// =====================================================

export function ImprintEN() {
  return (
    <div className="legal-text">
      <h3>Information according to § 5 DDG (German Digital Services Act)</h3>
      <p>Roman Kuskowski</p>

      <h3>Contact</h3>
      <p>Email: admin@masterselects.com</p>

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
      <p>
        <strong>MasterSelects works locally by default.</strong> Projects and media are processed in your browser.
        Apart from the technically necessary delivery of the website, data leaves your device only when you invoke a
        feature clearly identified as a cloud, download, login, payment, or provider feature.
      </p>

      <h3>2. Data Controller</h3>
      <p>Roman Kuskowski<br />Email: admin@masterselects.com</p>

      <h3>3. Hosting and Website Requests</h3>
      <p>
        This website is hosted by <strong>Cloudflare, Inc.</strong> (101 Townsend St, San Francisco, CA 94107, USA).
        Cloudflare processes the IP address, requested URL, timestamp, referrer, and browser/device information to
        deliver and secure the site. Legal basis: Art. 6(1)(f) GDPR (secure and reliable delivery). Provider logs are
        erased under the contracted and configured retention rules once no longer needed for operations or security.
      </p>
      <p>
        For operational monitoring and abuse detection, we additionally store the path, timestamp, Cloudflare country
        and city, referrer, shortened user agent, and a pseudonymous identifier derived from the IP address and a secret
        salt. We do not store the plain IP in this live log. These events are automatically deleted after about one hour.
        Legal basis: Art. 6(1)(f) GDPR.
      </p>

      <h3>4. Accounts, Login, Email, and Payments</h3>
      <ul>
        <li><strong>Account data:</strong> Email, display name, credit balance, and usage history; Art. 6(1)(b) GDPR.</li>
        <li><strong>Google login:</strong> If selected, we receive the identity/contact data released by Google; Art. 6(1)(b) GDPR.</li>
        <li><strong>Transactional email:</strong> <strong>Resend</strong> processes recipient address and message content for login/account messages; Art. 6(1)(b) GDPR.</li>
        <li><strong>Payments:</strong> <strong>Stripe, Inc.</strong> processes payment and billing data. We do not store complete card or bank details; Art. 6(1)(b) and (c) GDPR.</li>
      </ul>
      <p>
        Login states expire after ten minutes and sessions after 30 days. Accounts and non-statutory usage data are
        retained for the contract term and then erased when no billing, security, or legal claim requires them.
        Invoices and accounting records are generally retained for eight years (§ 147 AO, § 14b UStG).
      </p>

      <h3>5. Cloud and AI Features</h3>
      <p>
        When you start a cloud or AI feature, the selected prompts, messages, media, references, and technical metadata
        are sent to the relevant provider. Depending on the feature, recipients include <strong>OpenAI</strong>,
        <strong>Kie.ai</strong> and its selected model/upload providers, and <strong>ElevenLabs</strong>. When you use
        your own API key, the browser may connect directly to OpenAI, Anthropic, AssemblyAI, Deepgram, PiAPI, Kie.ai,
        Evolink, ElevenLabs, or the YouTube Data API. Legal basis: Art. 6(1)(b) GDPR, supplemented by Art. 6(1)(f)
        GDPR for security and abuse prevention.
      </p>
      <p>
        Hosted AI chat may store prompts, responses, tool calls, moderation results, token counts, credit cost, duration,
        status, errors, and a pseudonymous IP hash for account history, billing, support, and abuse prevention. Content is
        erased when no longer needed for those purposes or after a valid erasure request, without affecting statutory
        billing records.
      </p>

      <h3>6. Local Storage and External Resources</h3>
      <p>
        Projects, settings, encrypted personal API keys, and media references are stored in Local Storage, IndexedDB,
        or OPFS and can be erased through browser data controls. If you explicitly select a Google font or download an
        AI/audio model, your browser connects to Google Fonts or Hugging Face and transmits the IP address and requested
        resource. If you open Native Helper release information or GitHub links, your browser connects to GitHub. The
        demo video is served by MasterSelects and makes no YouTube connection.
      </p>

      <h3>7. Cookies and Device Storage</h3>
      <p>
        We use no analytics or marketing cookies. Necessary cookies protect login states (up to ten minutes) and
        sessions (up to 30 days). Only after you actively check the free-credit offer does a necessary cookie bind the
        requested offer to that browser for up to one hour. Server-side visit monitoring stores nothing on the device.
      </p>

      <h3>8. International Transfers</h3>
      <p>
        Some providers process data outside the European Economic Area. Transfers take place only under an Art. 45 GDPR
        adequacy decision or Art. 46 GDPR safeguards, particularly Standard Contractual Clauses. Information and copies
        of relevant safeguards can be requested at admin@masterselects.com.
      </p>

      <h3>9. Your Rights</h3>
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

      <h3>10. Required Data</h3>
      <p>
        The local editor can be used without an account. Account, payment, and cloud-credit data is contractually
        required for the relevant feature; without it, that feature cannot be provided.
      </p>

      <h3>11. Changes</h3>
      <p>The current version is always available at <a href="/privacy">/privacy</a>.</p>
      <p className="legal-meta">Last updated: July 17, 2026</p>
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

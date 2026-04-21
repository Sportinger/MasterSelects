import { useEffect } from 'react';
import { APP_VERSION } from '../version';
import { buildEditorHref } from '../routing/entryExperience';
import './landing.css';

const capabilityColumns = [
  {
    title: 'Media first',
    items: ['Video and audio timelines', 'Image sequences and stills', 'Fast jump into the editor'],
  },
  {
    title: 'Beyond media',
    items: ['PDF, SVG, JSON, CSV', '3D formats like OBJ, FBX, glTF', 'Everything can become a visual signal'],
  },
  {
    title: 'Operator flow',
    items: ['Landing for explanation and onboarding', 'Editor kept direct and uncluttered', 'Separate URL for power users'],
  },
];

const signalTags = ['Video', 'Audio', 'PDF', 'SVG', 'OBJ', 'JSON', 'CSV', 'glTF'];

export function LandingPage() {
  const editorHref = buildEditorHref(window.location);
  const portSuffix = window.location.port ? `:${window.location.port}` : '';
  const subdomainHref = `${window.location.protocol}//landing.localhost${portSuffix}/`;
  const fallbackLandingHref = `${window.location.protocol}//localhost${portSuffix}/landing`;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'MasterSelects Landing Preview';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="landing-page">
      <div className="landing-noise" aria-hidden="true" />

      <header className="landing-header">
        <div className="landing-brand">
          <span className="landing-brand-mark">MS</span>
          <div>
            <strong>MasterSelects</strong>
            <span>Landing Preview</span>
          </div>
        </div>
        <a className="landing-header-link" href={editorHref}>Open Editor</a>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="landing-kicker">Front Website Concept</span>
            <h1>Give MasterSelects a front door, without slowing down the editor.</h1>
            <p className="landing-lead">
              This is a separate landing page preview. The editor stays directly reachable, while the website can explain
              the product, show the vision, and funnel new users into the app with one strong action.
            </p>

            <div className="landing-actions">
              <a className="landing-button landing-button-primary" href={editorHref}>Start Editing</a>
              <a className="landing-button landing-button-secondary" href="#routes">See Dev Routes</a>
            </div>

            <div className="landing-signal-row" aria-label="Supported signal examples">
              {signalTags.map((tag) => (
                <span key={tag} className="landing-signal-chip">{tag}</span>
              ))}
            </div>
          </div>

          <div className="landing-stage" aria-hidden="true">
            <div className="landing-stage-card landing-stage-card-inputs">
              <span className="landing-stage-label">Incoming Files</span>
              <div className="landing-stage-list">
                <span>PDF becomes texture</span>
                <span>OBJ becomes geometry</span>
                <span>CSV becomes motion data</span>
              </div>
            </div>

            <div className="landing-stage-card landing-stage-card-core">
              <span className="landing-stage-label">MasterSelects</span>
              <strong>Timeline, composite, export</strong>
              <p>Keep the editor sharp. Let the landing page do the explaining.</p>
            </div>

            <div className="landing-stage-card landing-stage-card-output">
              <span className="landing-stage-label">Action</span>
              <div className="landing-stage-cta">Start Editing</div>
              <small>One click back into the app</small>
            </div>
          </div>
        </section>

        <section className="landing-metrics">
          <article>
            <span className="landing-metric-label">Entry split</span>
            <strong>Landing + editor</strong>
            <p>New visitors get context. Returning users still jump straight into work.</p>
          </article>
          <article>
            <span className="landing-metric-label">Dev mode</span>
            <strong>Separate URL</strong>
            <p>You can inspect the page live without changing the current root editor flow.</p>
          </article>
          <article>
            <span className="landing-metric-label">Current build</span>
            <strong>v{APP_VERSION}</strong>
            <p>This preview is wired into the existing Vite app entry and hot reload cycle.</p>
          </article>
        </section>

        <section className="landing-section">
          <div className="landing-section-heading">
            <span className="landing-section-kicker">Why this split works</span>
            <h2>The website sells the idea. The editor stays focused.</h2>
          </div>

          <div className="landing-columns">
            {capabilityColumns.map((column) => (
              <article key={column.title} className="landing-column-card">
                <h3>{column.title}</h3>
                <ul>
                  {column.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-routes" id="routes">
          <div className="landing-section-heading">
            <span className="landing-section-kicker">Dev routes</span>
            <h2>Use these URLs right now.</h2>
          </div>

          <div className="landing-route-grid">
            <article className="landing-route-card">
              <span className="landing-route-label">Editor stays here</span>
              <code>http://localhost{portSuffix}/</code>
              <p>Unchanged root entry for the working app.</p>
            </article>
            <article className="landing-route-card landing-route-card-accent">
              <span className="landing-route-label">Landing preview</span>
              <code>{subdomainHref}</code>
              <p>The separate dev subdomain for the front website concept.</p>
            </article>
            <article className="landing-route-card">
              <span className="landing-route-label">Fallback landing path</span>
              <code>{fallbackLandingHref}</code>
              <p>Use this if your browser does not resolve <code>landing.localhost</code>.</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}

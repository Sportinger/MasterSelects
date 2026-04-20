import { useEffect, useState } from 'react';
import { OPENAI_CHAT_DROPDOWN_MODELS } from '../shared/openAiModelCatalog';
import { getCatalogEntry } from '../services/flashboard/FlashBoardModelCatalog';
import { getCatalogEntryPriceEstimate } from '../services/flashboard/FlashBoardPricing';
import { APP_VERSION } from '../version';
import { buildEditorHref } from '../routing/entryExperience';
import './landing.css';

const galleryCards = [
  {
    eyebrow: 'Editor',
    title: 'Timeline, preview, scopes, and media browser in one real workspace.',
    copy: 'Use the actual product surface as the hero. It already communicates that MasterSelects is not a toy tool.',
    imageSrc: '/preview.png',
    imageAlt: 'MasterSelects editor showing preview, histogram, waveform, vectorscope, media browser, and timeline.',
  },
  {
    eyebrow: 'Multi Preview + Export',
    title: 'A second real shot can sell compositions, export, and panel density better than any mock.',
    copy: 'The export panel, dual previews, and timeline explain capability immediately when they are shown as they really are.',
    imageSrc: '/og-image.png',
    imageAlt: 'MasterSelects editor showing dual preview panels, export settings, media list, and timeline.',
  },
];

const signalPills = ['Real Screenshots', 'Editor First', 'Timeline', 'Preview', 'WebCodecs Fast'];
type PricingDetailTab = 'chat' | 'image' | 'video';

const planCards = [
  {
    badge: 'Entry',
    credits: 25,
    featured: false,
    fit: 'Try chat and small image runs.',
    id: 'free',
    priceAmount: '0',
    priceSuffix: 'EUR',
    title: 'Free',
  },
  {
    badge: 'Creator',
    credits: 4500,
    featured: false,
    fit: 'Built for image runs and short hosted video work.',
    id: 'starter',
    priceAmount: '4,90',
    priceSuffix: 'EUR / mo',
    title: 'Starter',
  },
  {
    badge: 'Popular',
    credits: 13500,
    featured: true,
    fit: 'Best fit for regular AI-assisted editing sessions.',
    id: 'pro',
    priceAmount: '14,90',
    priceSuffix: 'EUR / mo',
    title: 'Pro',
  },
  {
    badge: 'Production',
    credits: 27000,
    featured: false,
    fit: 'Largest pool for repeated generation and team use.',
    id: 'studio',
    priceAmount: '29,90',
    priceSuffix: 'EUR / mo',
    title: 'Studio',
  },
] as const;

function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCreditLabel(value: number): string {
  return `${formatCredits(value)} ${value === 1 ? 'credit' : 'credits'}`;
}

function extractCreditCount(label: string | null | undefined): number | null {
  if (!label) {
    return null;
  }

  const match = label.match(/(\d[\d,]*)/);

  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(value) ? value : null;
}

function formatCapacityCount(planCredits: number, unitCost: number | null): string {
  if (unitCost == null || unitCost <= 0) {
    return '--';
  }

  const count = Math.floor(planCredits / unitCost);
  return count < 1 ? '<1' : formatCredits(count);
}

const cheapestChatModel = OPENAI_CHAT_DROPDOWN_MODELS.reduce((lowest, current) => (
  current.creditCost < lowest.creditCost ? current : lowest
));
const balancedChatModel = OPENAI_CHAT_DROPDOWN_MODELS.find((model) => model.id === 'gpt-5.1') ?? cheapestChatModel;
const premiumChatModel = OPENAI_CHAT_DROPDOWN_MODELS.find((model) => model.id === 'gpt-5.4') ?? balancedChatModel;

const hostedImageEntry = getCatalogEntry('cloud', 'nano-banana-2');
const hostedVideoEntry = getCatalogEntry('cloud', 'cloud-kling');

const hostedImage1k = hostedImageEntry
  ? getCatalogEntryPriceEstimate(hostedImageEntry, { imageSize: '1K', outputType: 'image' })
  : null;
const hostedImage4k = hostedImageEntry
  ? getCatalogEntryPriceEstimate(hostedImageEntry, { imageSize: '4K', outputType: 'image' })
  : null;
const hostedVideoStd = hostedVideoEntry
  ? getCatalogEntryPriceEstimate(hostedVideoEntry, {
      duration: 5,
      generateAudio: false,
      mode: 'std',
      outputType: 'video',
    })
  : null;
const hostedVideoPro = hostedVideoEntry
  ? getCatalogEntryPriceEstimate(hostedVideoEntry, {
      duration: 10,
      generateAudio: true,
      mode: 'pro',
      outputType: 'video',
    })
  : null;
const hostedImage1kCredits = extractCreditCount(hostedImage1k?.fullLabel);
const hostedVideoStdCredits = extractCreditCount(hostedVideoStd?.fullLabel);

const planOutputExamples = [
  {
    basis: `${cheapestChatModel.label} request`,
    category: 'Approx chats',
    unitCost: cheapestChatModel.creditCost,
  },
  {
    basis: 'Nano Banana 2 Cloud, 1K',
    category: 'Approx images',
    unitCost: hostedImage1kCredits,
  },
  {
    basis: 'Kling Cloud, 5s standard',
    category: 'Approx videos',
    unitCost: hostedVideoStdCredits,
  },
] as const;

const aiCreditExamples = [
  {
    category: 'Chat',
    label: `${cheapestChatModel.label} request`,
    value: formatCreditLabel(cheapestChatModel.creditCost),
    note: 'Lowest current hosted chat cost in the dropdown.',
    tab: 'chat',
  },
  {
    category: 'Chat',
    label: `${balancedChatModel.label} request`,
    value: formatCreditLabel(balancedChatModel.creditCost),
    note: 'Balanced default for stronger editing and assistant work.',
    tab: 'chat',
  },
  {
    category: 'Chat',
    label: `${premiumChatModel.label} request`,
    value: formatCreditLabel(premiumChatModel.creditCost),
    note: 'Higher-end chat tier for heavier requests.',
    tab: 'chat',
  },
  {
    category: 'Image',
    label: 'Nano Banana 2 Cloud, 1K',
    value: hostedImage1k?.fullLabel ?? '--',
    note: 'Hosted image generation at the smallest listed cloud resolution.',
    tab: 'image',
  },
  {
    category: 'Image',
    label: 'Nano Banana 2 Cloud, 4K',
    value: hostedImage4k?.fullLabel ?? '--',
    note: 'High-resolution cloud image generation.',
    tab: 'image',
  },
  {
    category: 'Video',
    label: 'Kling Cloud, 5s standard',
    value: hostedVideoStd?.fullLabel ?? '--',
    note: 'Shortest standard hosted video example on the landing page.',
    tab: 'video',
  },
  {
    category: 'Video',
    label: 'Kling Cloud, 10s pro + sound',
    value: hostedVideoPro?.fullLabel ?? '--',
    note: 'Heaviest example shown here for hosted video generation.',
    tab: 'video',
  },
] as const;

const pricingReferenceCards: Array<{ id: PricingDetailTab; eyebrow: string; note: string; value: string }> = [
  {
    eyebrow: 'Cheapest chat',
    id: 'chat',
    note: cheapestChatModel.label,
    value: formatCreditLabel(cheapestChatModel.creditCost),
  },
  {
    eyebrow: 'Cheapest image',
    id: 'image',
    note: 'Nano Banana 2 Cloud',
    value: hostedImage1k?.fullLabel ?? '--',
  },
  {
    eyebrow: 'Cheapest video',
    id: 'video',
    note: 'Kling Cloud standard',
    value: hostedVideoStd?.fullLabel ?? '--',
  },
];

const pricingDetailTabs: Array<{ id: PricingDetailTab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Video' },
];

export function LandingPage() {
  const editorHref = buildEditorHref(window.location);
  const portSuffix = window.location.port ? `:${window.location.port}` : '';
  const subdomainHref = `${window.location.protocol}//landing.localhost${portSuffix}/`;
  const fallbackLandingHref = `${window.location.protocol}//localhost${portSuffix}/landing`;
  const [isPricingExpanded, setIsPricingExpanded] = useState(false);
  const [activePricingTab, setActivePricingTab] = useState<PricingDetailTab>('chat');

  const activeUsageExamples = aiCreditExamples.filter((entry) => entry.tab === activePricingTab);

  const openPricingTab = (tab: PricingDetailTab) => {
    setActivePricingTab(tab);
    setIsPricingExpanded(true);
  };

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'MasterSelects Landing Preview';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="landing-page">
      <div className="landing-grid" aria-hidden="true" />

      <header className="landing-header">
        <div className="landing-brand">
          <div className="landing-brand-stack">
            <strong>MasterSelects</strong>
            <span>Landing Preview</span>
          </div>
          <span className="landing-build">v{APP_VERSION}</span>
        </div>

        <nav className="landing-nav" aria-label="Landing actions">
          <a className="landing-nav-link" href="#gallery">Screens</a>
          <a className="landing-nav-link" href="#pricing">AI Credits</a>
          <a className="landing-nav-link" href="#routes">Dev URLs</a>
          <a className="landing-button landing-button-secondary" href={editorHref}>Open Editor</a>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="landing-kicker">One-Line Positioning</span>
            <h1>The media editor wherever you want it.</h1>
            <p className="landing-lead">
              MasterSelects puts timeline editing, AI video, preview, scopes, and export into one workspace that you
              can open directly or enter through a clean front page.
            </p>

            <div className="landing-pill-row" aria-label="Landing design principles">
              {signalPills.map((pill, index) => (
                <span key={pill} className={`landing-pill ${index === 0 ? 'landing-pill-active' : ''}`}>
                  {pill}
                </span>
              ))}
            </div>

            <div className="landing-actions">
              <a className="landing-button landing-button-primary" href={editorHref}>Start Editing</a>
              <a className="landing-button landing-button-secondary" href="#gallery">View Screens</a>
            </div>

            <div className="landing-route-strip">
              <div className="landing-route-chip">
                <span>Editor</span>
                <code>http://localhost{portSuffix}/</code>
              </div>
              <div className="landing-route-chip landing-route-chip-active">
                <span>Landing</span>
                <code>{subdomainHref}</code>
              </div>
            </div>
          </div>

          <div className="landing-hero-media">
            <figure className="landing-shot landing-shot-primary">
              <img
                src="/preview.png"
                alt="MasterSelects workspace with preview, scopes, media browser, and timeline."
              />
              <figcaption>Real workspace shot: preview, scopes, media browser, timeline.</figcaption>
            </figure>

            <figure className="landing-shot landing-shot-secondary">
              <img
                src="/og-image.png"
                alt="MasterSelects workspace with dual preview, export panel, and timeline."
              />
              <figcaption>Real workspace shot: dual preview and export.</figcaption>
            </figure>
          </div>
        </section>

        <section className="landing-gallery" id="gallery">
          {galleryCards.map((card) => (
            <article key={card.title} className="landing-gallery-card">
              <div className="landing-gallery-image-wrap">
                <img className="landing-gallery-image" src={card.imageSrc} alt={card.imageAlt} />
              </div>
              <div className="landing-gallery-copy">
                <span className="landing-card-kicker">{card.eyebrow}</span>
                <h2>{card.title}</h2>
                <p>{card.copy}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="landing-pricing-section" id="pricing">
          <div className="landing-pricing-header">
            <div className="landing-pricing-copy">
              <span className="landing-card-kicker">AI Credits</span>
              <h3>Monthly plans first. Real AI credit math right underneath.</h3>
              <p>
                Compare the monthly credit pools directly, then open the per-request breakdown for chat, image, and
                video generation with the current hosted rates.
              </p>
            </div>
            <button
              type="button"
              className="landing-button landing-button-secondary landing-pricing-toggle"
              onClick={() => setIsPricingExpanded((current) => !current)}
            >
              {isPricingExpanded ? 'Hide Cost Breakdown' : 'Open Cost Breakdown'}
            </button>
          </div>

          <div className="landing-pricing-reference-bar">
            {pricingReferenceCards.map((summary) => (
              <button
                key={summary.id}
                type="button"
                className={`landing-pricing-reference-card ${isPricingExpanded && activePricingTab === summary.id ? 'landing-pricing-reference-card-active' : ''}`}
                onClick={() => openPricingTab(summary.id)}
              >
                <span className="landing-pricing-reference-eyebrow">{summary.eyebrow}</span>
                <strong className="landing-pricing-reference-value">{summary.value}</strong>
                <span className="landing-pricing-reference-note">{summary.note}</span>
              </button>
            ))}
          </div>

          <div className="landing-plan-table-wrap">
            <table className="landing-plan-table">
              <thead>
                <tr>
                  <th className="landing-plan-table-corner" scope="col">
                    <span className="landing-card-kicker">Monthly Plans</span>
                    <p>Output counts use the cheapest current hosted option in each category.</p>
                  </th>
                  {planCards.map((plan) => (
                    <th
                      key={plan.id}
                      scope="col"
                      className={`landing-plan-column ${plan.featured ? 'landing-plan-column-featured' : ''}`}
                    >
                      <span className="landing-plan-column-badge">{plan.badge}</span>
                      <strong className="landing-plan-column-name">{plan.title}</strong>
                      <div className="landing-plan-column-price-block">
                        <span className="landing-plan-column-price">{plan.priceAmount}</span>
                        <span className="landing-plan-column-price-note">{plan.priceSuffix}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    <div className="landing-plan-row-copy">
                      <span className="landing-plan-row-label">Credits / month</span>
                      <span className="landing-plan-row-note">Monthly hosted credit pool</span>
                    </div>
                  </th>
                  {planCards.map((plan) => (
                    <td key={`${plan.id}-credits`} className={plan.featured ? 'landing-plan-table-cell-featured' : ''}>
                      <strong className="landing-plan-table-value">{formatCredits(plan.credits)}</strong>
                    </td>
                  ))}
                </tr>

                {planOutputExamples.map((example) => (
                  <tr key={example.category}>
                    <th scope="row">
                      <div className="landing-plan-row-copy">
                        <span className="landing-plan-row-label">{example.category}</span>
                        <span className="landing-plan-row-note">{example.basis}</span>
                      </div>
                    </th>
                    {planCards.map((plan) => (
                      <td
                        key={`${plan.id}-${example.category}`}
                        className={plan.featured ? 'landing-plan-table-cell-featured' : ''}
                      >
                        <strong className="landing-plan-table-value">
                          {formatCapacityCount(plan.credits, example.unitCost)}
                        </strong>
                      </td>
                    ))}
                  </tr>
                ))}

                <tr>
                  <th scope="row">
                    <div className="landing-plan-row-copy">
                      <span className="landing-plan-row-label">Built for</span>
                      <span className="landing-plan-row-note">How each plan reads on the landing page</span>
                    </div>
                  </th>
                  {planCards.map((plan) => (
                    <td key={`${plan.id}-fit`} className={plan.featured ? 'landing-plan-table-cell-featured' : ''}>
                      <span className="landing-plan-fit-copy">{plan.fit}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {isPricingExpanded && (
            <div className="landing-pricing-detail">
              <div className="landing-pricing-detail-topbar">
                <div className="landing-pricing-tab-row" role="tablist" aria-label="Detailed pricing tabs">
                  {pricingDetailTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activePricingTab === tab.id}
                      className={`landing-pricing-tab ${activePricingTab === tab.id ? 'landing-pricing-tab-active' : ''}`}
                      onClick={() => setActivePricingTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <p className="landing-pricing-detail-note">
                  Detailed costs are pulled from the same in-app chat, image, and video credit rules.
                </p>
              </div>

              <div className="landing-usage-list">
                {activeUsageExamples.map((entry) => (
                  <div key={`${entry.category}-${entry.label}`} className="landing-usage-row">
                    <div className="landing-usage-copy">
                      <span className="landing-usage-category">{entry.category}</span>
                      <strong>{entry.label}</strong>
                      <p>{entry.note}</p>
                    </div>
                    <span className="landing-usage-value">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="landing-info-grid">
          <article className="landing-info-card">
            <span className="landing-card-kicker">Direction</span>
            <h3>No fake interface blocks anymore.</h3>
            <p>
              The next step is not more illustrated UI. It is selecting the right real screenshots, cropping them well,
              and building the page around those shots.
            </p>
            <ul>
              <li>Hero uses the strongest editor screenshot.</li>
              <li>Secondary shots show export, AI video, pricing, or settings.</li>
              <li>Text should stay short and let the product surface do the work.</li>
            </ul>
          </article>

          <article className="landing-info-card landing-info-card-routes" id="routes">
            <span className="landing-card-kicker">Dev routes</span>
            <h3>Root stays the editor. Landing stays separate.</h3>
            <div className="landing-route-list">
              <div className="landing-route-card">
                <span>Editor</span>
                <code>http://localhost{portSuffix}/</code>
              </div>
              <div className="landing-route-card landing-route-card-active">
                <span>Landing subdomain</span>
                <code>{subdomainHref}</code>
              </div>
              <div className="landing-route-card">
                <span>Landing fallback</span>
                <code>{fallbackLandingHref}</code>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}

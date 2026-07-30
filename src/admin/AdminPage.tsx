import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import './AdminPage.css';

type ClaimStatus = 'available' | 'claimed' | 'expired' | 'revoked';
type ClaimFilter = 'available' | 'claimed' | 'all';

interface AdminCreditClaim {
  amount: number;
  claimedAt: string | null;
  claimedEmail: string | null;
  createdAt: string;
  createdBy: string;
  description: string | null;
  expectedEmail: string | null;
  expiresAt: string | null;
  id: string;
  link: string | null;
  rotatable: boolean;
  status: ClaimStatus;
  title: string;
}

interface AdminDashboardSnapshot {
  claims: AdminCreditClaim[];
  cloudflare: {
    configured: boolean;
    d1: {
      fileSize: number | null;
      name: string;
      numTables: number | null;
      readReplication: string | null;
      region: string | null;
      version: string | null;
    } | null;
    deployments: Array<{
      branch: string | null;
      commitHash: string | null;
      commitMessage: string | null;
      createdAt: string | null;
      environment: string | null;
      id: string;
      status: string;
      url: string | null;
    }>;
    error: string | null;
    project: {
      domains: string[];
      name: string;
      productionBranch: string | null;
    } | null;
    traffic: {
      available: boolean;
      bytes7d: number;
      daily: Array<{ bytes: number; date: string; requests: number; visits: number }>;
      requests7d: number;
      statusCodes: Array<{ count: number; status: number }>;
      topPaths: Array<{ bytes: number; path: string; requests: number }>;
      visits7d: number;
    };
    visitsLastHour: {
      countries: Array<{ count: number; country: string }>;
      paths: Array<{ count: number; path: string }>;
      requests: number;
      uniqueVisitors: number;
    };
  };
  generatedAt: string;
  growth: {
    aiRequests: Array<{ count: number; day: string }>;
    signups: Array<{ count: number; day: string }>;
  };
  recentUsers: Array<{
    balance: number;
    createdAt: string;
    displayName: string;
    email: string;
    id: string;
    lastAiModel: string | null;
    lastAppVersion: string | null;
    lastLoginAt: string | null;
    planId: string | null;
    subscriptionStatus: string | null;
  }>;
  stats: {
    activePaidCustomers: number;
    activeUsers30d: number;
    activeUsers7d: number;
    claimedCreditLinks: number;
    conversionRate: number;
    creditsGranted30d: number;
    creditsSpent30d: number;
    estimatedMrrEur: number;
    expiredCreditLinks: number;
    failedAiRequests7d: number;
    newUsers30d: number;
    newUsers7d: number;
    openCreditAmount: number;
    openCreditLinks: number;
    outstandingCredits: number;
    requests24h: number;
    requests7d: number;
    revokedCreditLinks: number;
    totalUsers: number;
    trialingCustomers: number;
  };
  subscriptions: Array<{ count: number; planId: string; status: string }>;
}

interface SessionResponse {
  authenticated: boolean;
  configured: boolean;
  csrfToken?: string;
  expiresAt?: string;
}

interface ApiErrorPayload {
  message?: string;
}

class AdminApiError extends Error {
  readonly configured: boolean | undefined;
  readonly status: number;

  constructor(message: string, status: number, configured?: boolean) {
    super(message);
    this.configured = configured;
    this.status = status;
  }
}

async function adminApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (!response.ok) {
    const configured = 'configured' in payload && typeof payload.configured === 'boolean'
      ? payload.configured
      : undefined;
    throw new AdminApiError(
      payload.message || `Anfrage fehlgeschlagen (${response.status}).`,
      response.status,
      configured,
    );
  }
  return payload;
}

const integerFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const currencyFormat = new Intl.NumberFormat('de-DE', {
  currency: 'EUR',
  maximumFractionDigits: 2,
  style: 'currency',
});
const compactFormat = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  notation: 'compact',
});
const dateTimeFormat = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const shortDateFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
});

function formatDate(value: string | null, fallback = '—'): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : dateTimeFormat.format(date);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${decimalFormat.format(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${decimalFormat.format(bytes / 1024 ** 2)} MB`;
  return `${decimalFormat.format(bytes / 1024 ** 3)} GB`;
}

function MetricCard({
  accent,
  detail,
  eyebrow,
  value,
}: {
  accent: 'blue' | 'green' | 'orange' | 'violet';
  detail: string;
  eyebrow: string;
  value: string;
}) {
  return (
    <article className={`admin-metric admin-metric--${accent}`}>
      <div className="admin-metric__top">
        <span>{eyebrow}</span>
        <span className="admin-metric__signal" aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function BarChart({
  data,
  emptyLabel,
}: {
  data: Array<{ count: number; day: string }>;
  emptyLabel: string;
}) {
  const maximum = Math.max(1, ...data.map((entry) => entry.count));
  if (data.length === 0) {
    return <div className="admin-empty-chart">{emptyLabel}</div>;
  }

  return (
    <div className="admin-bar-chart" aria-label="Verlauf der letzten 14 Tage">
      {data.map((entry) => {
        const height = Math.max(5, Math.round((entry.count / maximum) * 100));
        return (
          <div className="admin-bar-chart__item" key={entry.day}>
            <span className="admin-bar-chart__value">{integerFormat.format(entry.count)}</span>
            <span
              className="admin-bar-chart__bar"
              style={{ height: `${height}%` }}
              title={`${shortDateFormat.format(new Date(entry.day))}: ${integerFormat.format(entry.count)}`}
            />
            <span className="admin-bar-chart__date">{shortDateFormat.format(new Date(entry.day))}</span>
          </div>
        );
      })}
    </div>
  );
}

function Panel({
  children,
  className = '',
  eyebrow,
  title,
  toolbar,
}: {
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  title: string;
  toolbar?: ReactNode;
}) {
  return (
    <section className={`admin-panel ${className}`}>
      <header className="admin-panel__header">
        <div>
          {eyebrow && <span className="admin-eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {toolbar && <div className="admin-panel__toolbar">{toolbar}</div>}
      </header>
      {children}
    </section>
  );
}

function LoginView({
  configured,
  initialError,
  onAuthenticated,
}: {
  configured: boolean;
  initialError: string;
  onAuthenticated: (session: SessionResponse) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || busy || !configured) return;
    setBusy(true);
    setError('');
    try {
      const session = await adminApi<SessionResponse>('/api/admin/login', {
        body: JSON.stringify({ password }),
        method: 'POST',
      });
      setPassword('');
      onAuthenticated(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Die Anmeldung ist fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login">
      <div className="admin-login__glow admin-login__glow--one" />
      <div className="admin-login__glow admin-login__glow--two" />
      <section className="admin-login__card" aria-labelledby="admin-login-title">
        <a className="admin-brand" href="/" aria-label="Zurück zu MasterSelects">
          <span className="admin-brand__mark">M</span>
          <span>MasterSelects</span>
        </a>
        <span className="admin-eyebrow">Private operations</span>
        <h1 id="admin-login-title">Admin-Zugang</h1>
        <p className="admin-login__copy">
          Live-Zahlen, Nutzer, Abos und Credit-Links – nur für dich.
        </p>
        {!configured ? (
          <div className="admin-alert admin-alert--warning" role="alert">
            Der Admin-Zugang ist serverseitig noch nicht eingerichtet. Setze zuerst Passwort-Hash
            und Session-Secret.
          </div>
        ) : (
          <form className="admin-login__form" onSubmit={handleSubmit}>
            <label htmlFor="admin-password">Passwort</label>
            <input
              autoComplete="current-password"
              autoFocus
              id="admin-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Admin-Passwort"
              type="password"
              value={password}
            />
            {error && <div className="admin-alert admin-alert--danger" role="alert">{error}</div>}
            <button className="admin-button admin-button--primary" disabled={!password || busy} type="submit">
              {busy ? 'Wird geprüft …' : 'Sicher anmelden'}
            </button>
          </form>
        )}
        <div className="admin-login__security">
          <span className="admin-live-dot" aria-hidden="true" />
          8-Stunden-Session · Rate Limit · CSRF-Schutz
        </div>
      </section>
    </main>
  );
}

function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const labels: Record<ClaimStatus, string> = {
    available: 'Offen',
    claimed: 'Eingelöst',
    expired: 'Abgelaufen',
    revoked: 'Widerrufen',
  };
  return <span className={`admin-status admin-status--${status}`}>{labels[status]}</span>;
}

function CreditLinksPanel({
  claims,
  csrfToken,
  onClaimsChanged,
}: {
  claims: AdminCreditClaim[];
  csrfToken: string;
  onClaimsChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<ClaimFilter>('available');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('100');
  const [title, setTitle] = useState('MasterSelects Credits');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [expiresDays, setExpiresDays] = useState('30');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState('');
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState('');
  const [copied, setCopied] = useState('');

  const visibleClaims = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return claims.filter((claim) => {
      if (filter !== 'all' && claim.status !== filter) return false;
      if (!needle) return true;
      return [
        claim.title,
        claim.expectedEmail,
        claim.claimedEmail,
        claim.description,
        claim.id,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [claims, filter, search]);

  async function copyLink(link: string, claimId: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(claimId);
      window.setTimeout(() => setCopied((current) => current === claimId ? '' : current), 1800);
    } catch {
      setError('Der Link konnte nicht in die Zwischenablage kopiert werden.');
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setCreatedLink('');
    try {
      const response = await adminApi<{ claim: AdminCreditClaim }>('/api/admin/claims', {
        body: JSON.stringify({
          amount: Number(amount),
          description,
          expectedEmail: email,
          expiresDays: Number(expiresDays),
          title,
          unlocked,
        }),
        headers: { 'x-masterselects-admin-csrf': csrfToken },
        method: 'POST',
      });
      setCreatedLink(response.claim.link ?? '');
      setFilter('available');
      await onClaimsChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Der Credit-Link konnte nicht erstellt werden.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRotate(claim: AdminCreditClaim) {
    const confirmed = window.confirm(
      'Diesen Link erneuern? Der bisherige Link wird dadurch sofort ungültig.',
    );
    if (!confirmed) return;
    setActionId(claim.id);
    setError('');
    try {
      const response = await adminApi<{ claim: AdminCreditClaim }>(
        `/api/admin/claims/${encodeURIComponent(claim.id)}/rotate`,
        {
          headers: { 'x-masterselects-admin-csrf': csrfToken },
          method: 'POST',
        },
      );
      if (response.claim.link) {
        setCreatedLink(response.claim.link);
      }
      await onClaimsChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Der Link konnte nicht erneuert werden.');
    } finally {
      setActionId('');
    }
  }

  return (
    <Panel
      className="admin-credit-panel"
      eyebrow="Credits"
      title="Credit-Links"
      toolbar={(
        <button
          className="admin-button admin-button--primary admin-button--compact"
          onClick={() => setShowForm((current) => !current)}
          type="button"
        >
          {showForm ? 'Formular schließen' : '+ Neuer Link'}
        </button>
      )}
    >
      {showForm && (
        <form className="admin-credit-form" onSubmit={handleCreate}>
          <label>
            <span>Credits</span>
            <input
              min="1"
              max="1000000"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="1"
              type="number"
              value={amount}
            />
          </label>
          <label>
            <span>Titel</span>
            <input
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              required
              type="text"
              value={title}
            />
          </label>
          <label className="admin-credit-form__wide">
            <span>Beschreibung <small>optional</small></span>
            <input
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Zum Beispiel: Community-Gewinnspiel Juli"
              type="text"
              value={description}
            />
          </label>
          <label>
            <span>Empfänger-E-Mail</span>
            <input
              disabled={unlocked}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={unlocked ? 'Für jedes Konto freigegeben' : 'name@example.com'}
              required={!unlocked}
              type="email"
              value={email}
            />
          </label>
          <label>
            <span>Gültig für Tage <small>0 = unbegrenzt</small></span>
            <input
              max="3650"
              min="0"
              onChange={(event) => setExpiresDays(event.target.value)}
              required
              step="1"
              type="number"
              value={expiresDays}
            />
          </label>
          <label className="admin-check admin-credit-form__wide">
            <input
              checked={unlocked}
              onChange={(event) => setUnlocked(event.target.checked)}
              type="checkbox"
            />
            <span>
              Für jedes angemeldete Konto einlösbar
              <small>Nur aktivieren, wenn der Link frei weitergegeben werden darf.</small>
            </span>
          </label>
          <div className="admin-credit-form__actions admin-credit-form__wide">
            <button className="admin-button admin-button--primary" disabled={busy} type="submit">
              {busy ? 'Link wird erstellt …' : 'Credit-Link erstellen'}
            </button>
          </div>
        </form>
      )}

      {createdLink && (
        <div className="admin-created-link">
          <div>
            <strong>Link ist bereit</strong>
            <span>Der vollständige Token ist verschlüsselt gespeichert.</span>
          </div>
          <code>{createdLink}</code>
          <button
            className="admin-button admin-button--secondary admin-button--compact"
            onClick={() => void copyLink(createdLink, 'new')}
            type="button"
          >
            {copied === 'new' ? 'Kopiert' : 'Kopieren'}
          </button>
        </div>
      )}
      {error && <div className="admin-alert admin-alert--danger" role="alert">{error}</div>}

      <div className="admin-claims-controls">
        <div className="admin-segmented" aria-label="Credit-Links filtern">
          {([
            ['available', `Offen (${claims.filter((claim) => claim.status === 'available').length})`],
            ['claimed', `Eingelöst (${claims.filter((claim) => claim.status === 'claimed').length})`],
            ['all', `Alle (${claims.length})`],
          ] as Array<[ClaimFilter, string]>).map(([value, label]) => (
            <button
              aria-pressed={filter === value}
              className={filter === value ? 'is-active' : ''}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <input
          aria-label="Credit-Links durchsuchen"
          className="admin-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Titel, E-Mail oder ID suchen"
          type="search"
          value={search}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-claims-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Link</th>
              <th>Credits</th>
              <th>Empfänger</th>
              <th>Erstellt / Ablauf</th>
              <th><span className="admin-visually-hidden">Aktion</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleClaims.map((claim) => (
              <tr key={claim.id}>
                <td><ClaimStatusBadge status={claim.status} /></td>
                <td>
                  <strong className="admin-table__primary">{claim.title}</strong>
                  <span className="admin-table__secondary">{claim.description || claim.id.slice(0, 13)}</span>
                </td>
                <td className="admin-table__number">+{integerFormat.format(claim.amount)}</td>
                <td>
                  <span className="admin-table__primary">
                    {claim.claimedEmail || claim.expectedEmail || 'Jedes Konto'}
                  </span>
                  {claim.claimedAt && (
                    <span className="admin-table__secondary">Eingelöst {formatDate(claim.claimedAt)}</span>
                  )}
                </td>
                <td>
                  <span className="admin-table__primary">{formatDate(claim.createdAt)}</span>
                  <span className="admin-table__secondary">
                    {claim.expiresAt ? `bis ${formatDate(claim.expiresAt)}` : 'Kein Ablauf'}
                  </span>
                </td>
                <td className="admin-table__action">
                  {claim.link && claim.status === 'available' && (
                    <button
                      className="admin-button admin-button--secondary admin-button--compact"
                      onClick={() => void copyLink(claim.link!, claim.id)}
                      type="button"
                    >
                      {copied === claim.id ? 'Kopiert' : 'Link kopieren'}
                    </button>
                  )}
                  {claim.rotatable && (
                    <button
                      className="admin-button admin-button--secondary admin-button--compact"
                      disabled={actionId === claim.id}
                      onClick={() => void handleRotate(claim)}
                      type="button"
                    >
                      {actionId === claim.id ? 'Wird erneuert …' : 'Link erneuern'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visibleClaims.length === 0 && (
              <tr>
                <td className="admin-table__empty" colSpan={6}>
                  Keine passenden Credit-Links.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CloudflarePanel({ data }: { data: AdminDashboardSnapshot['cloudflare'] }) {
  const latestDeployment = data.deployments[0];
  return (
    <Panel className="admin-cloudflare" eyebrow="Infrastructure" title="Cloudflare live">
      <div className="admin-cloudflare__hero">
        <div>
          <span className="admin-cloudflare__icon">CF</span>
          <div>
            <strong>{data.project?.name || 'MasterSelects'}</strong>
            <span>{data.project?.domains.join(' · ') || 'Cloudflare Pages'}</span>
          </div>
        </div>
        <span className={`admin-health ${data.error ? 'admin-health--warning' : ''}`}>
          <span className="admin-live-dot" />
          {data.error ? 'Teilweise verfügbar' : data.configured ? 'Verbunden' : 'Token fehlt'}
        </span>
      </div>

      {data.error && <div className="admin-alert admin-alert--warning">{data.error}</div>}

      <div className="admin-infra-grid">
        <div className="admin-infra-stat">
          <span>Requests letzte Stunde</span>
          <strong>{integerFormat.format(data.visitsLastHour.requests)}</strong>
          <small>{integerFormat.format(data.visitsLastHour.uniqueVisitors)} eindeutige Besucher</small>
        </div>
        <div className="admin-infra-stat">
          <span>Traffic 7 Tage</span>
          <strong>
            {data.traffic.available ? compactFormat.format(data.traffic.requests7d) : '—'}
          </strong>
          <small>
            {data.traffic.available
              ? `${compactFormat.format(data.traffic.visits7d)} Visits · ${formatBytes(data.traffic.bytes7d)}`
              : 'Zone Analytics optional'}
          </small>
        </div>
        <div className="admin-infra-stat">
          <span>D1 Datenbank</span>
          <strong>{formatBytes(data.d1?.fileSize ?? null)}</strong>
          <small>
            {data.d1
              ? `${data.d1.numTables ?? '—'} Tabellen · ${data.d1.region || 'Region automatisch'}`
              : 'Metadaten nicht geladen'}
          </small>
        </div>
        <div className="admin-infra-stat">
          <span>Letztes Deployment</span>
          <strong className="admin-infra-stat__status">{latestDeployment?.status || '—'}</strong>
          <small>{formatDate(latestDeployment?.createdAt ?? null)}</small>
        </div>
      </div>

      <div className="admin-cloudflare__details">
        <div>
          <h3>Top-Pfade · letzte Stunde</h3>
          <ol className="admin-ranked-list">
            {data.visitsLastHour.paths.map((entry) => (
              <li key={entry.path}>
                <span title={entry.path}>{entry.path}</span>
                <strong>{integerFormat.format(entry.count)}</strong>
              </li>
            ))}
            {data.visitsLastHour.paths.length === 0 && <li className="admin-muted">Noch keine Daten.</li>}
          </ol>
        </div>
        <div>
          <h3>Länder · letzte Stunde</h3>
          <ol className="admin-ranked-list">
            {data.visitsLastHour.countries.map((entry) => (
              <li key={entry.country}>
                <span>{entry.country}</span>
                <strong>{integerFormat.format(entry.count)}</strong>
              </li>
            ))}
            {data.visitsLastHour.countries.length === 0 && <li className="admin-muted">Noch keine Daten.</li>}
          </ol>
        </div>
        <div>
          <h3>Deployments</h3>
          <ol className="admin-deployment-list">
            {data.deployments.slice(0, 4).map((deployment) => (
              <li key={deployment.id}>
                <span className={`admin-deploy-dot admin-deploy-dot--${deployment.status}`} />
                <div>
                  <strong>{deployment.commitMessage || deployment.branch || 'Cloudflare Pages'}</strong>
                  <span>
                    {deployment.commitHash || deployment.environment || 'production'} · {formatDate(deployment.createdAt)}
                  </span>
                </div>
              </li>
            ))}
            {data.deployments.length === 0 && <li className="admin-muted">Keine Deployment-Daten.</li>}
          </ol>
        </div>
      </div>
    </Panel>
  );
}

function DashboardView({
  csrfToken,
  onLogout,
}: {
  csrfToken: string;
  onLogout: () => void;
}) {
  const [dashboard, setDashboard] = useState<AdminDashboardSnapshot | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    setError('');
    try {
      setDashboard(await adminApi<AdminDashboardSnapshot>('/api/admin/dashboard'));
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 401) {
        onLogout();
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Die Live-Daten konnten nicht geladen werden.');
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [onLogout]);

  useEffect(() => {
    void loadDashboard();
    const interval = window.setInterval(() => void loadDashboard(true), 60_000);
    return () => window.clearInterval(interval);
  }, [loadDashboard]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await adminApi('/api/admin/logout', {
        headers: { 'x-masterselects-admin-csrf': csrfToken },
        method: 'POST',
      });
    } catch {
      // Clear the local view even if the session expired on the server.
    } finally {
      setLoggingOut(false);
      onLogout();
    }
  }

  if (!dashboard && refreshing) {
    return (
      <main className="admin-loading">
        <span className="admin-loader" />
        <strong>Live-Daten werden geladen</strong>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="admin-loading">
        <div className="admin-alert admin-alert--danger">{error || 'Dashboard nicht verfügbar.'}</div>
        <button className="admin-button admin-button--primary" onClick={() => void loadDashboard()} type="button">
          Erneut versuchen
        </button>
      </main>
    );
  }

  const { stats } = dashboard;
  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a className="admin-brand" href="/">
          <span className="admin-brand__mark">M</span>
          <span>MasterSelects <small>Operations</small></span>
        </a>
        <div className="admin-topbar__actions">
          <span className="admin-live">
            <span className="admin-live-dot" />
            Live · {formatDate(dashboard.generatedAt)}
          </span>
          <button
            className="admin-button admin-button--secondary admin-button--compact"
            disabled={refreshing}
            onClick={() => void loadDashboard()}
            type="button"
          >
            {refreshing ? 'Aktualisiert …' : 'Aktualisieren'}
          </button>
          <button
            className="admin-button admin-button--ghost admin-button--compact"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
            type="button"
          >
            Abmelden
          </button>
        </div>
      </header>

      <div className="admin-content">
        <section className="admin-hero">
          <div>
            <span className="admin-eyebrow">Business overview</span>
            <h1>Guten Überblick.</h1>
            <p>Die wichtigsten MasterSelects-Zahlen auf einen Blick.</p>
          </div>
          <div className="admin-hero__pulse">
            <span><i className="admin-live-dot" /> Systeme aktiv</span>
            <strong>{integerFormat.format(stats.requests24h)}</strong>
            <small>AI-Anfragen in 24 Stunden</small>
          </div>
        </section>

        {error && <div className="admin-alert admin-alert--warning">{error}</div>}

        <section className="admin-metrics" aria-label="Kernzahlen">
          <MetricCard
            accent="blue"
            detail={`+${integerFormat.format(stats.newUsers7d)} in den letzten 7 Tagen`}
            eyebrow="Registrierte Nutzer"
            value={integerFormat.format(stats.totalUsers)}
          />
          <MetricCard
            accent="green"
            detail={`${integerFormat.format(stats.trialingCustomers)} aktuell im Trial`}
            eyebrow="Zahlende Kunden"
            value={integerFormat.format(stats.activePaidCustomers)}
          />
          <MetricCard
            accent="violet"
            detail={`MRR-Schätzung ${currencyFormat.format(stats.estimatedMrrEur)}`}
            eyebrow="Conversion"
            value={`${decimalFormat.format(stats.conversionRate * 100)} %`}
          />
          <MetricCard
            accent="orange"
            detail={`${integerFormat.format(stats.openCreditAmount)} Credits noch nicht eingelöst`}
            eyebrow="Offene Credit-Links"
            value={integerFormat.format(stats.openCreditLinks)}
          />
        </section>

        <section className="admin-secondary-metrics" aria-label="Weitere Kennzahlen">
          <div><span>Aktiv 7 Tage</span><strong>{integerFormat.format(stats.activeUsers7d)}</strong></div>
          <div><span>Aktiv 30 Tage</span><strong>{integerFormat.format(stats.activeUsers30d)}</strong></div>
          <div><span>AI-Anfragen 7 Tage</span><strong>{compactFormat.format(stats.requests7d)}</strong></div>
          <div><span>Fehler 7 Tage</span><strong>{integerFormat.format(stats.failedAiRequests7d)}</strong></div>
          <div><span>Credits vergeben · 30 T.</span><strong>{integerFormat.format(stats.creditsGranted30d)}</strong></div>
          <div><span>Credits verbraucht · 30 T.</span><strong>{integerFormat.format(stats.creditsSpent30d)}</strong></div>
        </section>

        <CreditLinksPanel
          claims={dashboard.claims}
          csrfToken={csrfToken}
          onClaimsChanged={() => loadDashboard()}
        />

        <section className="admin-two-column">
          <Panel eyebrow="Growth" title="Neue Nutzer · 14 Tage">
            <BarChart data={dashboard.growth.signups} emptyLabel="Noch keine Registrierungen im Zeitraum." />
          </Panel>
          <Panel eyebrow="Usage" title="AI-Anfragen · 14 Tage">
            <BarChart data={dashboard.growth.aiRequests} emptyLabel="Noch keine AI-Anfragen im Zeitraum." />
          </Panel>
        </section>

        <Panel
          eyebrow="Accounts"
          title="Neueste Nutzer"
          toolbar={<span className="admin-muted">{dashboard.recentUsers.length} zuletzt registrierte Konten</span>}
        >
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nutzer</th>
                  <th>Plan</th>
                  <th>Credits</th>
                  <th>Letzter Login</th>
                  <th>App / Modell</th>
                  <th>Registriert</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong className="admin-table__primary">{user.displayName || 'Ohne Anzeigenamen'}</strong>
                      <span className="admin-table__secondary">{user.email}</span>
                    </td>
                    <td>
                      <span className={`admin-plan admin-plan--${user.planId || 'free'}`}>
                        {user.planId || 'free'}
                      </span>
                      <span className="admin-table__secondary">{user.subscriptionStatus || '—'}</span>
                    </td>
                    <td className="admin-table__number">{integerFormat.format(user.balance)}</td>
                    <td>{formatDate(user.lastLoginAt, 'Noch nie')}</td>
                    <td>
                      <span className="admin-table__primary">{user.lastAppVersion || '—'}</span>
                      <span className="admin-table__secondary">{user.lastAiModel || 'Kein Modell'}</span>
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <section className="admin-two-column admin-two-column--infra">
          <CloudflarePanel data={dashboard.cloudflare} />
          <Panel eyebrow="Billing" title="Abo-Verteilung">
            <div className="admin-subscriptions">
              {dashboard.subscriptions.map((subscription) => (
                <div className="admin-subscription-row" key={`${subscription.planId}:${subscription.status}`}>
                  <div>
                    <span className={`admin-plan admin-plan--${subscription.planId}`}>{subscription.planId}</span>
                    <span>{subscription.status}</span>
                  </div>
                  <strong>{integerFormat.format(subscription.count)}</strong>
                </div>
              ))}
              {dashboard.subscriptions.length === 0 && (
                <div className="admin-empty-chart">Noch keine Abo-Daten.</div>
              )}
            </div>
            <div className="admin-billing-summary">
              <div>
                <span>Aktive Bezahlkunden</span>
                <strong>{integerFormat.format(stats.activePaidCustomers)}</strong>
              </div>
              <div>
                <span>Geschätzter MRR</span>
                <strong>{currencyFormat.format(stats.estimatedMrrEur)}</strong>
              </div>
            </div>
            <p className="admin-footnote">
              Der MRR ist eine Schätzung aus den aktuellen Listenpreisen, nicht der Stripe-Umsatz.
            </p>
          </Panel>
        </section>
      </div>
    </main>
  );
}

export function AdminPage() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [csrfToken, setCsrfToken] = useState('');
  const [initialError, setInitialError] = useState('');

  useEffect(() => {
    let active = true;
    adminApi<SessionResponse>('/api/admin/session')
      .then((session) => {
        if (!active) return;
        setConfigured(session.configured);
        setCsrfToken(session.csrfToken ?? '');
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof AdminApiError && caught.status === 401) {
          setConfigured(caught.configured ?? true);
          return;
        }
        setInitialError(caught instanceof Error ? caught.message : 'Der Admin-Status ist nicht erreichbar.');
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (checkingSession) {
    return (
      <main className="admin-loading">
        <span className="admin-loader" />
        <strong>Sicherer Bereich wird geöffnet</strong>
      </main>
    );
  }

  if (!csrfToken) {
    return (
      <LoginView
        configured={configured}
        initialError={initialError}
        onAuthenticated={(session) => {
          setConfigured(session.configured);
          setCsrfToken(session.csrfToken ?? '');
        }}
      />
    );
  }

  return <DashboardView csrfToken={csrfToken} onLogout={() => setCsrfToken('')} />;
}

export default AdminPage;

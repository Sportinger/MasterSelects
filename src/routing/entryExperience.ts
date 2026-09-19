export type EntryExperience =
  | 'creditClaim'
  | 'chat'
  | 'editor'
  | 'medium'
  | 'imprint'
  | 'landing'
  | 'privacy'
  | 'terms'
  | 'withdrawal'
  | 'cancellation';

export type LegalEntryExperience = Extract<EntryExperience, 'imprint' | 'privacy' | 'terms' | 'withdrawal' | 'cancellation'>;

interface EntryLocationLike {
  hash?: string;
  hostname: string;
  pathname: string;
  search?: string;
  protocol?: string;
  port?: string;
}

const LANDING_HOST = 'landing.localhost';
const LANDING_PATHS = ['/landing'];
const LEGACY_LANDING_PATHS = ['/landing-preview'];
const CHAT_PATHS = ['/chat'];
const CREDIT_CLAIM_PATHS = ['/credits/claim', '/claim'];
const ROOT_PATHS = ['/', '/index.html'];
const EDITOR_PATHS = ['/editor'];
const MEDIUM_PATHS = ['/medium'];
const IMPRINT_PATHS = ['/impressum', '/imprint'];
const PRIVACY_PATHS = ['/datenschutz', '/privacy'];
// Keep in sync with LEGAL_PAGE_PATHS in src/legal/consumerContractTexts.ts.
const TERMS_PATHS = ['/agb', '/terms'];
const WITHDRAWAL_PATHS = ['/widerruf', '/withdrawal'];
const CANCELLATION_PATHS = ['/kuendigen', '/cancel'];
const ENGLISH_LEGAL_PATHS = ['/imprint', '/privacy', '/terms', '/withdrawal', '/cancel'];
export const LANDING_PAGE_ENABLED = false;
const LANDING_RETURN_STATE_KEY = '__masterselectsLandingReturn';

type LandingReturnHistoryState = 'entry' | 'landing';

interface LandingReturnHistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

function withLandingReturnMarker(
  state: unknown,
  marker: LandingReturnHistoryState,
): Record<string, unknown> {
  const preservedState = state !== null && typeof state === 'object' && !Array.isArray(state)
    ? state as Record<string, unknown>
    : state == null
      ? {}
      : { previousHistoryState: state };

  return {
    ...preservedState,
    [LANDING_RETURN_STATE_KEY]: marker,
  };
}

export function createLandingBackedEntryState(state: unknown): Record<string, unknown> {
  return withLandingReturnMarker(state, 'entry');
}

export function ensureDirectEntryReturnsToLanding(
  locationLike: EntryLocationLike,
  historyLike: LandingReturnHistoryLike,
): boolean {
  if (!LANDING_PAGE_ENABLED) return false;

  if (
    !isChatPath(locationLike.pathname)
    && !isEditorPath(locationLike.pathname)
    && !isMediumPath(locationLike.pathname)
  ) {
    return false;
  }

  const currentState = historyLike.state;
  if (
    currentState !== null
    && typeof currentState === 'object'
    && (currentState as Record<string, unknown>)[LANDING_RETURN_STATE_KEY] === 'entry'
  ) {
    return false;
  }

  const entryUrl = `${locationLike.pathname}${locationLike.search ?? ''}${locationLike.hash ?? ''}`;
  historyLike.replaceState(withLandingReturnMarker(currentState, 'landing'), '', '/landing');
  historyLike.pushState(createLandingBackedEntryState(currentState), '', entryUrl);
  return true;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return '/';
  }

  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

function matchesPathPrefix(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function hasEditorOverride(search = ''): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  return params.has('test') || params.get('entry') === 'editor';
}

export function isLandingHost(hostname: string): boolean {
  return normalizeHostname(hostname) === LANDING_HOST;
}

export function isLandingPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return LANDING_PATHS.some((basePath) => matchesPathPrefix(normalizedPath, basePath));
}

export function isLegacyLandingPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return LEGACY_LANDING_PATHS.some((basePath) => matchesPathPrefix(normalizedPath, basePath));
}

export function isChatPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return CHAT_PATHS.some((basePath) => matchesPathPrefix(normalizedPath, basePath));
}

export function isEditorPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return EDITOR_PATHS.some((basePath) => matchesPathPrefix(normalizedPath, basePath));
}

export function isMediumPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return MEDIUM_PATHS.some((basePath) => matchesPathPrefix(normalizedPath, basePath));
}

export function isCreditClaimPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return CREDIT_CLAIM_PATHS.some((basePath) => matchesPathPrefix(normalizedPath, basePath));
}

/** Legal pages resolved from the pathname, or null for any other route. */
export function resolveLegalEntryExperience(pathname: string): LegalEntryExperience | null {
  const normalizedPath = normalizePathname(pathname);
  if (IMPRINT_PATHS.includes(normalizedPath)) return 'imprint';
  if (PRIVACY_PATHS.includes(normalizedPath)) return 'privacy';
  if (TERMS_PATHS.includes(normalizedPath)) return 'terms';
  if (WITHDRAWAL_PATHS.includes(normalizedPath)) return 'withdrawal';
  if (CANCELLATION_PATHS.includes(normalizedPath)) return 'cancellation';
  return null;
}

/** English aliases open the legal dialog in English; German paths default to German. */
export function isEnglishLegalPath(pathname: string): boolean {
  return ENGLISH_LEGAL_PATHS.includes(normalizePathname(pathname));
}

export function isSupportedPagePath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return ROOT_PATHS.includes(normalizedPath)
    // Static product information, built separately from the React editor.
    || normalizedPath === '/about'
    || normalizedPath === '/about/index.html'
    || isLandingPath(normalizedPath)
    || isLegacyLandingPath(normalizedPath)
    || isChatPath(normalizedPath)
    || isEditorPath(normalizedPath)
    || isMediumPath(normalizedPath)
    || isCreditClaimPath(normalizedPath)
    || resolveLegalEntryExperience(normalizedPath) !== null;
}

export function resolveEntryExperience(locationLike: EntryLocationLike): EntryExperience {
  if (hasEditorOverride(locationLike.search)) {
    return 'editor';
  }

  if (isCreditClaimPath(locationLike.pathname)) {
    return 'creditClaim';
  }

  const legalExperience = resolveLegalEntryExperience(locationLike.pathname);
  if (legalExperience) {
    return legalExperience;
  }

  if (isChatPath(locationLike.pathname)) {
    return 'chat';
  }

  if (isEditorPath(locationLike.pathname)) {
    return 'editor';
  }

  if (isMediumPath(locationLike.pathname)) {
    return 'medium';
  }

  if (
    isLandingHost(locationLike.hostname)
    || isLandingPath(locationLike.pathname)
    || isLegacyLandingPath(locationLike.pathname)
    || ROOT_PATHS.includes(normalizePathname(locationLike.pathname))
  ) {
    return LANDING_PAGE_ENABLED ? 'landing' : 'editor';
  }

  return LANDING_PAGE_ENABLED ? 'landing' : 'editor';
}

export function buildEditorHref(locationLike: EntryLocationLike): string {
  if (!isLandingHost(locationLike.hostname)) return '/editor';
  const protocol = locationLike.protocol ?? 'http:';
  const port = locationLike.port ? `:${locationLike.port}` : '';
  return `${protocol}//localhost${port}/editor`;
}

export function buildMediumHref(locationLike: EntryLocationLike): string {
  if (!isLandingHost(locationLike.hostname)) return '/medium';
  const protocol = locationLike.protocol ?? 'http:';
  const port = locationLike.port ? `:${locationLike.port}` : '';
  return `${protocol}//localhost${port}/medium`;
}

export function buildLandingHref(locationLike: EntryLocationLike): string {
  if (!LANDING_PAGE_ENABLED) return buildEditorHref(locationLike);
  if (!isLandingHost(locationLike.hostname)) return '/landing';
  const protocol = locationLike.protocol ?? 'http:';
  const port = locationLike.port ? `:${locationLike.port}` : '';
  return `${protocol}//localhost${port}/landing`;
}

export function buildChatHref(locationLike: EntryLocationLike): string {
  if (!isLandingHost(locationLike.hostname)) return '/chat';
  const protocol = locationLike.protocol ?? 'http:';
  const port = locationLike.port ? `:${locationLike.port}` : '';
  return `${protocol}//localhost${port}/chat`;
}

export function canonicalEntryPath(locationLike: EntryLocationLike): string | null {
  if (hasEditorOverride(locationLike.search)) return null;
  const pathname = normalizePathname(locationLike.pathname);
  const isLandingEntry = (
    (isLandingHost(locationLike.hostname) && ROOT_PATHS.includes(pathname))
    || ROOT_PATHS.includes(pathname)
    || isLandingPath(pathname)
    || isLegacyLandingPath(pathname)
  );

  if (!LANDING_PAGE_ENABLED && isLandingEntry) {
    return '/editor';
  }

  if (
    (isLandingHost(locationLike.hostname) && ROOT_PATHS.includes(pathname))
    || ROOT_PATHS.includes(pathname)
    || isLegacyLandingPath(pathname)
  ) {
    return '/landing';
  }
  return null;
}

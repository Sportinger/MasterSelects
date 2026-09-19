import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react';
import {
  IconAlertTriangle,
  IconMusic,
  IconPhoto,
  IconSearch,
  IconVideo,
} from '@tabler/icons-react';
import {
  discoveryAssetKey,
  downloadDiscoveredAsset,
  externalOriginForAsset,
  searchImgflipTemplates,
  searchMemegenTemplates,
  searchOpenverse,
  searchWikimediaCommons,
  type MediaDiscoveryAsset,
  type MediaDiscoveryContentFilter,
  type MediaDiscoveryKind,
} from '../../../services/mediaDiscovery';
import { useMediaStore } from '../../../stores/mediaStore';
import { parseDownloadUrls } from '../../../stores/mediaDownloadStore';
import { MediaDiscoveryCard, type MediaDiscoveryImportState } from './MediaDiscoveryCard';
import {
  MEDIA_DISCOVERY_WEB_SOURCES,
  MediaDiscoveryDownloads,
  type MediaDiscoveryWebSource,
} from './MediaDiscoveryDownloads';
import './MediaDiscoveryPanel.css';

type DiscoveryProviderId = ProviderGroup['id'];

const CATEGORIES = [
  { kind: 'image' as const, label: 'Image', Icon: IconPhoto },
  { kind: 'video' as const, label: 'Video', Icon: IconVideo },
  { kind: 'audio' as const, label: 'Audio', Icon: IconMusic },
];

const CONTENT_FILTERS: Record<
  MediaDiscoveryKind,
  Array<{ id: MediaDiscoveryContentFilter; label: string }>
> = {
  image: [
    { id: 'all', label: 'All' },
    { id: 'memes', label: 'Memes' },
    { id: 'gifs', label: 'GIFs' },
    { id: 'stickers', label: 'Stickers' },
    { id: 'reactions', label: 'Reactions' },
  ],
  video: [
    { id: 'all', label: 'All' },
    { id: 'memes', label: 'Memes' },
    { id: 'reactions', label: 'Reactions' },
    { id: 'green-screen', label: 'Green Screen' },
    { id: 'overlays', label: 'Overlays' },
  ],
  audio: [
    { id: 'all', label: 'All' },
    { id: 'memes', label: 'Memes' },
    { id: 'reactions', label: 'Reactions' },
    { id: 'sound-effects', label: 'Sound FX' },
    { id: 'music', label: 'Music' },
    { id: 'viral', label: 'Viral' },
  ],
};

const IMAGE_SUGGESTIONS: Partial<Record<MediaDiscoveryContentFilter, string[]>> & { all: string[] } = {
  all: ['reaction', 'green screen', 'space'],
  memes: ['drake', 'distracted boyfriend', 'this is fine'],
  gifs: ['reaction', 'loading', 'applause'],
  stickers: ['arrow', 'sparkle', 'speech bubble'],
  reactions: ['surprised', 'laughing', 'facepalm'],
};

const SUGGESTIONS: Record<Exclude<MediaDiscoveryKind, 'image'>, string[]> = {
  video: ['explosion', 'countdown', 'particles'],
  audio: ['applause', 'whoosh', 'crowd reaction'],
};

const FILTER_SUGGESTIONS: Partial<Record<MediaDiscoveryContentFilter, string[]>> = {
  memes: ['dramatic reaction', 'fail', 'comedy'],
  reactions: ['surprised', 'laughter', 'crowd gasp'],
  'green-screen': ['smoke', 'explosion', 'person'],
  overlays: ['film burn', 'particles', 'light leak'],
  'sound-effects': ['whoosh', 'impact', 'record scratch'],
  music: ['comedy', 'suspense', 'upbeat'],
  viral: ['meme sound', 'internet', 'short sting'],
};

const ALL_PROVIDERS: DiscoveryProviderId[] = [
  'wikimedia-commons',
  'openverse',
  'memegen',
  'imgflip',
];

interface ProviderGroup {
  id: 'wikimedia-commons' | 'openverse' | 'memegen' | 'imgflip';
  label: string;
  description: string;
  assets: MediaDiscoveryAsset[];
  error?: string;
}

const PROVIDER_DETAILS: Record<DiscoveryProviderId, Pick<ProviderGroup, 'label' | 'description'>> = {
  'wikimedia-commons': {
    label: 'Wikimedia Commons',
    description: 'Open-license media from the Wikimedia community',
  },
  openverse: {
    label: 'Openverse',
    description: 'Openly licensed media across public collections',
  },
  memegen: {
    label: 'Memegen.link',
    description: 'Curated meme templates; underlying image rights are not verified',
  },
  imgflip: {
    label: 'Imgflip',
    description: 'Top 100 user-uploaded meme templates; rights are not verified',
  },
};

function providerIsAvailable(
  provider: DiscoveryProviderId,
  kind: MediaDiscoveryKind,
  contentFilter: MediaDiscoveryContentFilter,
): boolean {
  if (kind === 'video') return provider === 'wikimedia-commons';
  if (kind === 'audio') return provider === 'wikimedia-commons' || provider === 'openverse';
  if (provider === 'wikimedia-commons' || provider === 'openverse') return true;
  if (contentFilter === 'gifs' || contentFilter === 'stickers') return false;
  return true;
}

function unavailableProviderLabel(
  provider: DiscoveryProviderId,
  kind: MediaDiscoveryKind,
  contentFilter: MediaDiscoveryContentFilter,
): string {
  const label = PROVIDER_DETAILS[provider].label;
  if (kind === 'video') return `${label} · no video`;
  if (kind === 'audio') return `${label} · no audio`;
  if (contentFilter === 'gifs') return `${label} · no GIF import`;
  return `${label} · no stickers`;
}

function compatibleProviderSelection(
  selectedProviders: DiscoveryProviderId[],
  kind: MediaDiscoveryKind,
  contentFilter: MediaDiscoveryContentFilter,
): DiscoveryProviderId[] {
  const hasCompatibleSelection = selectedProviders
    .some((provider) => providerIsAvailable(provider, kind, contentFilter));
  return hasCompatibleSelection
    ? selectedProviders
    : ALL_PROVIDERS.filter((provider) => providerIsAvailable(provider, kind, contentFilter));
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'This source took too long to respond. Try the search again.';
  }
  if (error instanceof Error) return error.message;
  return 'Search failed.';
}

export function MediaDiscoveryPanel() {
  const importFile = useMediaStore((store) => store.importFile);
  const [kind, setKind] = useState<MediaDiscoveryKind>('image');
  const [contentFilter, setContentFilter] = useState<MediaDiscoveryContentFilter>('all');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [enabledProviders, setEnabledProviders] = useState<DiscoveryProviderId[]>(ALL_PROVIDERS);
  const [enabledWebSources, setEnabledWebSources] = useState<MediaDiscoveryWebSource[]>(['youtube']);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importStates, setImportStates] = useState<Record<string, MediaDiscoveryImportState>>({});
  const searchController = useRef<AbortController | null>(null);

  useEffect(() => () => searchController.current?.abort(), []);

  const runSearch = useCallback(async (
    nextQuery: string,
    nextKind: MediaDiscoveryKind,
    requestedProviders: DiscoveryProviderId[],
    nextContentFilter: MediaDiscoveryContentFilter,
  ) => {
    const cleanQuery = nextQuery.trim();
    if (!cleanQuery) return;
    const directUrls = parseDownloadUrls(cleanQuery);
    if (directUrls.length === 1) {
      searchController.current?.abort();
      setSubmittedQuery(directUrls[0] ?? cleanQuery);
      setGroups([]);
      setIsSearching(false);
      return;
    }
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSubmittedQuery(cleanQuery);
    setIsSearching(true);
    setGroups([]);

    const activeProviders = requestedProviders
      .filter((provider) => providerIsAvailable(provider, nextKind, nextContentFilter));
    const requests: Promise<ProviderGroup>[] = [];

    if (activeProviders.includes('wikimedia-commons')) {
      requests.push(searchWikimediaCommons(cleanQuery, nextKind, controller.signal, nextContentFilter)
        .then((assets): ProviderGroup => ({
          id: 'wikimedia-commons',
          ...PROVIDER_DETAILS['wikimedia-commons'],
          assets,
        }))
        .catch((error): ProviderGroup => ({
          id: 'wikimedia-commons',
          ...PROVIDER_DETAILS['wikimedia-commons'],
          assets: [],
          error: errorMessage(error),
        })));
    }

    if (nextKind !== 'video' && activeProviders.includes('openverse')) {
      requests.push(searchOpenverse(cleanQuery, nextKind, controller.signal, nextContentFilter)
        .then((assets): ProviderGroup => ({
          id: 'openverse',
          ...PROVIDER_DETAILS.openverse,
          assets,
        }))
        .catch((error): ProviderGroup => ({
          id: 'openverse',
          ...PROVIDER_DETAILS.openverse,
          assets: [],
          error: errorMessage(error),
        })));
    }

    if (nextKind === 'image' && activeProviders.includes('memegen')) {
      requests.push(searchMemegenTemplates(cleanQuery, controller.signal)
        .then((assets): ProviderGroup => ({ id: 'memegen', ...PROVIDER_DETAILS.memegen, assets }))
        .catch((error): ProviderGroup => ({
          id: 'memegen',
          ...PROVIDER_DETAILS.memegen,
          assets: [],
          error: errorMessage(error),
        })));
    }

    if (nextKind === 'image' && activeProviders.includes('imgflip')) {
      requests.push(searchImgflipTemplates(cleanQuery, controller.signal)
        .then((assets): ProviderGroup => ({ id: 'imgflip', ...PROVIDER_DETAILS.imgflip, assets }))
        .catch((error): ProviderGroup => ({
          id: 'imgflip',
          ...PROVIDER_DETAILS.imgflip,
          assets: [],
          error: errorMessage(error),
        })));
    }

    const providerOrder = new Map(ALL_PROVIDERS.map((provider, index) => [provider, index]));
    const results = await Promise.all(requests.map(async (request) => {
      const group = await request;
      if (searchController.current === controller && !controller.signal.aborted) {
        setGroups((currentGroups) => [
          ...currentGroups.filter((currentGroup) => currentGroup.id !== group.id),
          group,
        ].toSorted((left, right) => (
          (providerOrder.get(left.id) ?? 0) - (providerOrder.get(right.id) ?? 0)
        )));
      }
      return group;
    }));
    if (searchController.current !== controller || controller.signal.aborted) return;
    setGroups(results);
    setIsSearching(false);
  }, []);

  const submitInput = useCallback((nextInput: string) => {
    const cleanInput = nextInput.trim();
    if (!cleanInput) return;
    const urls = parseDownloadUrls(cleanInput);
    if (urls.length === 1) {
      searchController.current?.abort();
      setSubmittedQuery(urls[0] ?? cleanInput);
      setGroups([]);
      setIsSearching(false);
      return;
    }
    void runSearch(cleanInput, kind, enabledProviders, contentFilter);
  }, [contentFilter, enabledProviders, kind, runSearch]);

  const pasteIntoSearch = (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedText = event.clipboardData.getData('text').trim();
    const urls = parseDownloadUrls(pastedText);
    if (urls.length !== 1) return;
    event.preventDefault();
    const url = urls[0] ?? pastedText;
    setQuery(url);
    submitInput(url);
  };

  const chooseKind = (nextKind: MediaDiscoveryKind) => {
    const nextContentFilter = CONTENT_FILTERS[nextKind]
      .some((filter) => filter.id === contentFilter)
      ? contentFilter
      : 'all';
    const compatibleSelectedProviders = enabledProviders
      .filter((provider) => providerIsAvailable(provider, nextKind, nextContentFilter));
    const hasWebSource = nextKind !== 'image' && enabledWebSources.length > 0;
    const nextProviders = compatibleSelectedProviders.length > 0 || hasWebSource
      ? enabledProviders
      : compatibleProviderSelection(enabledProviders, nextKind, nextContentFilter);
    setKind(nextKind);
    setContentFilter(nextContentFilter);
    setEnabledProviders(nextProviders);
    if (submittedQuery) void runSearch(submittedQuery, nextKind, nextProviders, nextContentFilter);
  };

  const toggleProvider = (provider: DiscoveryProviderId) => {
    if (!providerIsAvailable(provider, kind, contentFilter)) return;
    const enabledAvailableProviders = enabledProviders
      .filter((candidate) => providerIsAvailable(candidate, kind, contentFilter));
    const enabledAvailableWebSources = kind === 'image' ? [] : enabledWebSources;
    if (
      enabledProviders.includes(provider)
      && enabledAvailableProviders.length + enabledAvailableWebSources.length === 1
    ) return;
    const nextProviders = enabledProviders.includes(provider)
      ? enabledProviders.filter((candidate) => candidate !== provider)
      : ALL_PROVIDERS.filter((candidate) => candidate === provider || enabledProviders.includes(candidate));
    setEnabledProviders(nextProviders);
    if (submittedQuery) void runSearch(submittedQuery, kind, nextProviders, contentFilter);
  };

  const toggleWebSource = (source: MediaDiscoveryWebSource) => {
    if (kind === 'image') return;
    const enabledAvailableProviders = enabledProviders
      .filter((provider) => providerIsAvailable(provider, kind, contentFilter));
    if (
      enabledWebSources.includes(source)
      && enabledWebSources.length + enabledAvailableProviders.length === 1
    ) return;
    setEnabledWebSources((currentSources) => (
      currentSources.includes(source)
        ? currentSources.filter((candidate) => candidate !== source)
        : [...currentSources, source]
    ));
  };

  const chooseContentFilter = (nextContentFilter: MediaDiscoveryContentFilter) => {
    const compatibleSelectedProviders = enabledProviders
      .filter((provider) => providerIsAvailable(provider, kind, nextContentFilter));
    const hasWebSource = kind !== 'image' && enabledWebSources.length > 0;
    const nextProviders = compatibleSelectedProviders.length > 0 || hasWebSource
      ? enabledProviders
      : compatibleProviderSelection(enabledProviders, kind, nextContentFilter);
    setContentFilter(nextContentFilter);
    setEnabledProviders(nextProviders);
    if (submittedQuery) void runSearch(submittedQuery, kind, nextProviders, nextContentFilter);
  };

  const searchOpenMediaToo = () => {
    const nextProviders = ALL_PROVIDERS.filter((provider) => (
      provider === 'wikimedia-commons'
      || provider === 'openverse'
      || enabledProviders.includes(provider)
    ));
    setEnabledProviders(nextProviders);
    void runSearch(submittedQuery, kind, nextProviders, contentFilter);
  };

  const importAsset = async (asset: MediaDiscoveryAsset) => {
    const key = discoveryAssetKey(asset);
    setImportStates((states) => ({ ...states, [key]: { status: 'importing' } }));
    try {
      const file = await downloadDiscoveredAsset(asset);
      await importFile(file, null, {
        forceCopyToProject: true,
        externalOrigin: externalOriginForAsset(asset),
      });
      setImportStates((states) => ({ ...states, [key]: { status: 'added' } }));
    } catch (error) {
      const message = errorMessage(error);
      setImportStates((states) => ({
        ...states,
        [key]: { status: 'error', message },
      }));
    }
  };

  const resultCount = groups.reduce((total, group) => total + group.assets.length, 0);
  const searchFinishedEmpty = Boolean(submittedQuery)
    && !isSearching
    && resultCount === 0
    && (kind === 'image' || enabledWebSources.length === 0);
  const canExpandToOpenMedia = kind === 'image'
    && (!enabledProviders.includes('wikimedia-commons') || !enabledProviders.includes('openverse'));
  const suggestions = kind === 'image'
    ? IMAGE_SUGGESTIONS[contentFilter] ?? IMAGE_SUGGESTIONS.all
    : FILTER_SUGGESTIONS[contentFilter] ?? SUGGESTIONS[kind];
  const enabledAvailableProviders = enabledProviders
    .filter((provider) => providerIsAvailable(provider, kind, contentFilter));
  const enabledSourceCount = enabledAvailableProviders.length
    + (kind === 'image' ? 0 : enabledWebSources.length);

  return (
    <section className="media-discovery" aria-label="Discover media">
      <aside className="media-discovery-categories" aria-label="Media type">
        {CATEGORIES.map(({ kind: categoryKind, label, Icon }) => (
          <button
            key={categoryKind}
            type="button"
            className={kind === categoryKind ? 'active' : ''}
            onClick={() => chooseKind(categoryKind)}
            aria-pressed={kind === categoryKind}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </aside>

      <div className="media-discovery-main">
        <header className="media-discovery-header">
          <form
            className="media-discovery-search"
            onSubmit={(event) => {
              event.preventDefault();
              submitInput(query);
            }}
          >
            <IconSearch aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onPaste={pasteIntoSearch}
              placeholder={kind === 'image'
                ? 'Search images…'
                : `Search ${kind === 'video' ? 'videos' : 'audio'} or paste a URL…`}
              aria-label={`Search ${kind}`}
              autoComplete="off"
            />
            <button type="submit" disabled={!query.trim() || isSearching}>Search</button>
          </form>
          <div className="media-discovery-content-filters" role="group" aria-label={`${kind} content type`}>
              {CONTENT_FILTERS[kind].map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={contentFilter === filter.id ? 'active' : ''}
                  aria-pressed={contentFilter === filter.id}
                  onClick={() => chooseContentFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
          </div>
          <div className="media-discovery-source-toggles" role="group" aria-label="Search sources">
            <span>Sources</span>
            {ALL_PROVIDERS.map((provider) => {
              const available = providerIsAvailable(provider, kind, contentFilter);
              const active = available && enabledProviders.includes(provider);
              const isLastActive = active && enabledSourceCount === 1;
              return (
                <button
                  key={provider}
                  type="button"
                  className={active ? 'active' : ''}
                  aria-pressed={active}
                  disabled={!available || isLastActive}
                  title={!available
                    ? `${PROVIDER_DETAILS[provider].label} does not provide importable ${contentFilter === 'all' ? kind : contentFilter} results.`
                    : isLastActive
                      ? 'At least one source must stay enabled.'
                      : undefined}
                  onClick={() => toggleProvider(provider)}
                >
                  {available
                    ? PROVIDER_DETAILS[provider].label
                    : unavailableProviderLabel(provider, kind, contentFilter)}
                </button>
              );
            })}
            {kind !== 'image' && MEDIA_DISCOVERY_WEB_SOURCES.map((source) => {
              const active = enabledWebSources.includes(source.id);
              const isLastActive = active && enabledSourceCount === 1;
              return (
                <button
                  key={source.id}
                  type="button"
                  className={active ? 'active' : ''}
                  aria-pressed={active}
                  disabled={isLastActive}
                  title={isLastActive ? 'At least one source must stay enabled.' : undefined}
                  onClick={() => toggleWebSource(source.id)}
                >
                  {source.label}
                </button>
              );
            })}
          </div>
        </header>

        {kind !== 'image' && (
          <MediaDiscoveryDownloads
            kind={kind}
            submittedInput={submittedQuery}
            enabledSources={enabledWebSources}
          />
        )}

        {!submittedQuery && kind === 'image' && (
          <div className="media-discovery-empty">
            <div className="media-discovery-empty-icon"><IconSearch aria-hidden="true" /></div>
            <strong>Search media and meme catalogs</strong>
            <span>Try a subject, known template, reaction, sound effect, texture, overlay or place.</span>
            <div className="media-discovery-suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setQuery(suggestion);
                    void runSearch(suggestion, kind, enabledProviders, contentFilter);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {isSearching && (
          <div className="media-discovery-loading" aria-live="polite">
            <span />
            <span />
            <span />
            <p>Searching connected sources for “{submittedQuery}”</p>
          </div>
        )}

        {!isSearching && groups.length > 0 && (
          <div className="media-discovery-results" aria-live="polite">
            {groups.map((group) => (
              <section className="media-discovery-provider" key={group.id} aria-label={group.label}>
                <div className="media-discovery-provider-heading">
                  <div>
                    <h2>{group.label}</h2>
                    <p>{group.description}</p>
                  </div>
                  <span>{group.assets.length} result{group.assets.length === 1 ? '' : 's'}</span>
                </div>
                {group.error ? (
                  <div className="media-discovery-provider-error">
                    <IconAlertTriangle aria-hidden="true" />
                    <span>{group.error}</span>
                  </div>
                ) : group.assets.length === 0 ? (
                  <div className="media-discovery-provider-empty">No matching {kind} found here.</div>
                ) : (
                  <div className="media-discovery-grid">
                    {group.assets.map((asset) => (
                      <MediaDiscoveryCard
                        key={discoveryAssetKey(asset)}
                        asset={asset}
                        importState={importStates[discoveryAssetKey(asset)] ?? { status: 'idle' }}
                        onImport={(nextAsset) => void importAsset(nextAsset)}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
            {searchFinishedEmpty && canExpandToOpenMedia && (
              <div className="media-discovery-search-fallback">
                <div>
                  <strong>No match in the selected catalogs</strong>
                  <span>Wikimedia Commons and Openverse have a broader, open-license index.</span>
                </div>
                <button type="button" onClick={searchOpenMediaToo}>Search open media too</button>
              </div>
            )}
          </div>
        )}

        {searchFinishedEmpty && groups.length === 0 && (
          <div className="media-discovery-empty"><strong>No results</strong><span>Try a broader search.</span></div>
        )}
      </div>
    </section>
  );
}

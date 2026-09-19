import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconDownload,
  IconExternalLink,
  IconRefresh,
} from '@tabler/icons-react';
import {
  compactDownloadCodecLabel,
  downloadFormatAudioCodecLabel,
  downloadFormatQueueLabel,
  isAudioOnlyDownloadFormat,
  recommendedFormatsForKind,
  type MediaDiscoveryKind,
  type YouTubeDiscoveryResult,
} from '../../../services/mediaDiscovery';
import {
  NativeHelperClient,
  type NativeVideoSearchResult,
  type VideoInfo,
} from '../../../services/nativeHelper';
import {
  parseDownloadUrls,
  useMediaDownloadStore,
  type MediaDownloadJob,
} from '../../../stores/mediaDownloadStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { isDownloadAvailable } from '../../../services/youtubeDownloader';
import { openNativeHelperDialog } from '../../common/nativeHelperDialog';
import './MediaDiscoveryDownloads.css';

export type MediaDiscoveryWebSource = 'youtube' | 'instagram' | 'tiktok' | 'other-url';

export const MEDIA_DISCOVERY_WEB_SOURCES: ReadonlyArray<{
  id: MediaDiscoveryWebSource;
  label: string;
}> = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'other-url', label: 'Other URL' },
];

const PLATFORM_SEARCH: Record<'instagram' | 'tiktok', (query: string) => string> = {
  instagram: (query) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`,
  tiktok: (query) => `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`,
};

function formatDuration(seconds: number): string {
  if (!seconds) return '?:??';
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatViews(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const count = value ?? 0;
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B views`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}

function toYouTubeDiscoveryResult(result: NativeVideoSearchResult): YouTubeDiscoveryResult {
  return {
    ...result,
    duration: formatDuration(result.durationSeconds),
    publishedAt: '',
    viewCount: formatViews(result.viewCount),
  };
}

interface FormatResolutionState {
  url: string | null;
  info: VideoInfo | null;
  error: string | null;
  loading: boolean;
}

function jobStatusLabel(job: MediaDownloadJob): string {
  switch (job.status) {
    case 'queued': return 'Queued';
    case 'processing': return job.progress ? `${Math.round(job.progress * 100)}%` : 'Downloading';
    case 'completed': return 'Added to Media';
    case 'failed': return 'Failed';
    case 'canceled': return 'Canceled';
  }
}

function DiscoveryDownloadQueue() {
  const jobs = useMediaDownloadStore((state) => state.jobs);
  const retryJob = useMediaDownloadStore((state) => state.retryJob);
  const dismissJob = useMediaDownloadStore((state) => state.dismissJob);
  const visibleJobs = jobs.toSorted((left, right) => right.createdAt - left.createdAt).slice(0, 5);

  if (visibleJobs.length === 0) return null;

  return (
    <div className="media-discovery-download-queue" aria-label="Local download queue">
      {visibleJobs.map((job) => (
        <article key={job.id} className={`media-discovery-download-job ${job.status}`}>
          {job.thumbnail ? <img src={job.thumbnail} alt="" /> : <div className="media-discovery-download-job-placeholder" />}
          <div className="media-discovery-download-job-copy">
            <strong title={job.title}>{job.title}</strong>
            <span>{job.platform} · {jobStatusLabel(job)}{job.formatLabel ? ` · ${job.formatLabel}` : ''}</span>
            {job.error && <small>{job.error}</small>}
            {job.status === 'processing' && (
              <div className="media-discovery-download-progress" aria-hidden="true">
                <span style={{ width: `${Math.round((job.progress ?? 0.03) * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="media-discovery-download-job-actions">
            {job.status === 'failed' && <button type="button" onClick={() => retryJob(job.id)}>Retry</button>}
            {(job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') && (
              <button type="button" onClick={() => dismissJob(job.id)}>Dismiss</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

interface YouTubeResultsProps {
  results: YouTubeDiscoveryResult[];
  selectedUrl: string | null;
  onSelect: (result: YouTubeDiscoveryResult) => void;
}

function YouTubeResults({ results, selectedUrl, onSelect }: YouTubeResultsProps) {
  if (results.length === 0) return null;
  return (
    <div className="media-discovery-youtube-grid" aria-label="YouTube results">
      {results.map((result) => (
        <article key={result.id} className={selectedUrl === result.url ? 'selected' : ''}>
          <button type="button" className="media-discovery-youtube-preview" onClick={() => onSelect(result)}>
            <img src={result.thumbnail} alt="" loading="lazy" />
            <span>{result.duration}</span>
          </button>
          <div className="media-discovery-youtube-copy">
            <strong title={result.title}>{result.title}</strong>
            <span>{result.channelTitle}{result.viewCount ? ` · ${result.viewCount}` : ''}</span>
          </div>
          <div className="media-discovery-youtube-actions">
            <button type="button" onClick={() => onSelect(result)}>Resolutions</button>
            <a href={result.url} target="_blank" rel="noreferrer" title="Open source">
              <IconExternalLink aria-hidden="true" />
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}

interface MediaDiscoveryDownloadsProps {
  kind: Exclude<MediaDiscoveryKind, 'image'>;
  submittedInput: string;
  enabledSources: MediaDiscoveryWebSource[];
}

export function MediaDiscoveryDownloads({
  kind,
  submittedInput,
  enabledSources,
}: MediaDiscoveryDownloadsProps) {
  const enqueueDownloads = useMediaDownloadStore((state) => state.enqueueDownloads);
  const helperEnabled = useSettingsStore((state) => state.turboModeEnabled);
  const helperPort = useSettingsStore((state) => state.nativeHelperPort);
  const setNativeHelperConnected = useSettingsStore((state) => state.setNativeHelperConnected);
  const [helperConnected, setHelperConnected] = useState(isDownloadAvailable());
  const [helperSupportsSearch, setHelperSupportsSearch] = useState<boolean | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [results, setResults] = useState<YouTubeDiscoveryResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [formatState, setFormatState] = useState<FormatResolutionState>({
    url: null,
    info: null,
    error: null,
    loading: false,
  });

  const directUrl = useMemo(() => {
    const urls = parseDownloadUrls(submittedInput);
    return urls.length === 1 ? urls[0] ?? null : null;
  }, [submittedInput]);
  const isKeywordSearch = Boolean(submittedInput) && !directUrl;
  const youtubeEnabled = enabledSources.includes('youtube');

  useEffect(() => {
    let canceled = false;
    const readCapabilities = async (connected: boolean) => {
      setHelperConnected(connected);
      setNativeHelperConnected(connected);
      if (!connected) {
        setHelperSupportsSearch(null);
        return;
      }
      try {
        const startupCapability = NativeHelperClient.supportsMediaSearch();
        const supportsSearch = startupCapability
          ?? ((await NativeHelperClient.getInfo(15000)).media_search === true);
        if (!canceled) setHelperSupportsSearch(supportsSearch);
      } catch {
        if (!canceled) setHelperSupportsSearch(false);
      }
    };

    const connectHelper = async () => {
      if (!helperEnabled) {
        await readCapabilities(false);
        return;
      }
      NativeHelperClient.configure({ port: helperPort });
      const connected = isDownloadAvailable() || await NativeHelperClient.connect();
      if (!canceled) await readCapabilities(connected);
    };

    void connectHelper();
    const unsubscribe = NativeHelperClient.onStatusChange((status) => {
      void readCapabilities(status === 'connected');
    });
    return () => {
      canceled = true;
      unsubscribe();
    };
  }, [helperEnabled, helperPort, setNativeHelperConnected]);

  useEffect(() => {
    if (directUrl) {
      setSelectedUrl(directUrl);
      setQueueError(null);
    } else if (!submittedInput) {
      setSelectedUrl(null);
    }
  }, [directUrl, submittedInput]);

  useEffect(() => {
    if (!youtubeEnabled || !isKeywordSearch || !helperConnected || helperSupportsSearch !== true) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return undefined;
    }

    setIsSearching(true);
    setSearchError(null);
    let canceled = false;
    void NativeHelperClient.searchVideos(submittedInput, 12)
      .then((nextResults) => {
        if (canceled) return;
        setResults(nextResults.map(toYouTubeDiscoveryResult));
        setIsSearching(false);
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setResults([]);
        setSearchError(error instanceof Error ? error.message : 'YouTube search failed.');
        setIsSearching(false);
      });
    return () => { canceled = true; };
  }, [helperConnected, helperSupportsSearch, isKeywordSearch, retryRevision, submittedInput, youtubeEnabled]);

  useEffect(() => {
    if (!selectedUrl) {
      setFormatState({ url: null, info: null, error: null, loading: false });
      return undefined;
    }
    if (!helperConnected) {
      setFormatState({ url: selectedUrl, info: null, error: null, loading: false });
      return undefined;
    }

    let canceled = false;
    setFormatState({ url: selectedUrl, info: null, error: null, loading: true });
    void NativeHelperClient.listFormats(selectedUrl)
      .then((info) => {
        if (canceled) return;
        setFormatState({
          url: selectedUrl,
          info,
          error: info ? null : 'Could not read formats for this URL.',
          loading: false,
        });
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setFormatState({
          url: selectedUrl,
          info: null,
          error: error instanceof Error ? error.message : 'Could not read available formats.',
          loading: false,
        });
      });
    return () => { canceled = true; };
  }, [helperConnected, selectedUrl]);

  const formats = useMemo(() => (
    formatState.info ? recommendedFormatsForKind(formatState.info.recommendations, kind) : []
  ), [formatState.info, kind]);

  const chooseResult = useCallback((result: YouTubeDiscoveryResult) => {
    setSelectedUrl(result.url);
    setQueueError(null);
  }, []);

  const queueFormat = useCallback((formatId?: string, formatLabel = 'Helper default') => {
    if (!selectedUrl || !helperConnected) return;
    const jobIds = enqueueDownloads([{ url: selectedUrl, formatId, formatLabel }]);
    setQueueError(jobIds.length > 0 ? null : 'This URL is already queued.');
  }, [enqueueDownloads, helperConnected, selectedUrl]);

  const socialSources = enabledSources.filter((source): source is 'instagram' | 'tiktok' => (
    source === 'instagram' || source === 'tiktok'
  ));
  const showYouTube = youtubeEnabled && isKeywordSearch;
  const showFormatResults = Boolean(selectedUrl);

  return (
    <div className="media-discovery-web-results" aria-label="Web source results">
      {showYouTube && !helperConnected && (
        <div className="media-discovery-download-status">
          <span>Connect Native Helper to search YouTube locally.</span>
          <button type="button" onClick={openNativeHelperDialog}>Open Native Helper</button>
        </div>
      )}

      {showYouTube && helperConnected && helperSupportsSearch === null && (
        <div className="media-discovery-download-status">Checking Native Helper search…</div>
      )}

      {showYouTube && helperConnected && helperSupportsSearch === false && (
        <div className="media-discovery-download-status">
          <span>Native Helper is connected. Update it once to enable local YouTube search.</span>
          <button type="button" onClick={openNativeHelperDialog}>Open Native Helper</button>
        </div>
      )}

      {showYouTube && helperConnected && helperSupportsSearch === true && (
        <section className="media-discovery-platform-results" aria-label="YouTube search results">
          {isSearching && <div className="media-discovery-download-status">Searching YouTube…</div>}
          {!isSearching && searchError && (
            <div className="media-discovery-download-status error">
              <span>{searchError}</span>
              <button type="button" onClick={() => setRetryRevision((current) => current + 1)}>
                <IconRefresh aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {!isSearching && !searchError && results.length === 0 && (
            <div className="media-discovery-download-status">No matching YouTube videos.</div>
          )}
          <YouTubeResults results={results} selectedUrl={selectedUrl} onSelect={chooseResult} />
        </section>
      )}

      {isKeywordSearch && socialSources.length > 0 && (
        <div className="media-discovery-social-searches">
          {socialSources.map((source) => (
            <a key={source} href={PLATFORM_SEARCH[source](submittedInput)} target="_blank" rel="noreferrer">
              Search {source === 'instagram' ? 'Instagram' : 'TikTok'} <IconExternalLink aria-hidden="true" />
            </a>
          ))}
        </div>
      )}

      {showFormatResults && (
        <section className="media-discovery-format-results" aria-live="polite">
          {!helperConnected && (
            <div className="media-discovery-download-status">
              <span>Connect Native Helper to load resolutions for this URL.</span>
              <button type="button" onClick={openNativeHelperDialog}>Open Native Helper</button>
            </div>
          )}
          {helperConnected && formatState.loading && (
            <div className="media-discovery-download-status">Loading resolutions…</div>
          )}
          {helperConnected && !formatState.loading && formatState.error && (
            <div className="media-discovery-download-status error">{formatState.error}</div>
          )}
          {helperConnected && !formatState.loading && formatState.info && (
            <>
              <div className="media-discovery-format-heading">
                <div>
                  <strong>{formatState.info.title}</strong>
                  <span>{formatState.info.uploader}</span>
                </div>
                <a href={selectedUrl ?? undefined} target="_blank" rel="noreferrer" title="Open source">
                  <IconExternalLink aria-hidden="true" />
                </a>
              </div>
              <div className="media-discovery-format-grid">
                {formats.map((format) => {
                  const audioOnly = isAudioOnlyDownloadFormat(format);
                  const title = format.label || downloadFormatQueueLabel(format);
                  return (
                    <button
                      key={format.id}
                      type="button"
                      className="media-discovery-format-tile"
                      onClick={() => queueFormat(format.id, downloadFormatQueueLabel(format))}
                      title={`Download ${title}`}
                    >
                      {formatState.info?.thumbnail && (
                        <img src={formatState.info.thumbnail} alt="" loading="lazy" />
                      )}
                      <span className="media-discovery-format-tile-shade" />
                      <span className="media-discovery-format-resolution">
                        {audioOnly ? downloadFormatAudioCodecLabel(format) : format.resolution || 'Auto'}
                      </span>
                      <span className="media-discovery-format-details">
                        <strong>{title}</strong>
                        <small>
                          {audioOnly
                            ? 'Audio only'
                            : `${compactDownloadCodecLabel(format.vcodec, 'Video')} · ${downloadFormatAudioCodecLabel(format)}`}
                        </small>
                      </span>
                      <IconDownload aria-hidden="true" />
                    </button>
                  );
                })}
                {formats.length === 0 && (
                  <button
                    type="button"
                    className="media-discovery-format-tile default"
                    onClick={() => queueFormat()}
                  >
                    {formatState.info.thumbnail && <img src={formatState.info.thumbnail} alt="" />}
                    <span className="media-discovery-format-tile-shade" />
                    <span className="media-discovery-format-resolution">Auto</span>
                    <span className="media-discovery-format-details"><strong>Helper default</strong></span>
                    <IconDownload aria-hidden="true" />
                  </button>
                )}
              </div>
            </>
          )}
          {queueError && <div className="media-discovery-download-status error">{queueError}</div>}
        </section>
      )}

      <DiscoveryDownloadQueue />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { NativeHelperClient, type FormatRecommendation, type VideoInfo } from '../../../services/nativeHelper';
import { isDownloadAvailable } from '../../../services/youtubeDownloader';
import { parseDownloadUrls, useMediaDownloadStore } from '../../../stores/mediaDownloadStore';

const EMPTY_FORMAT_RECOMMENDATIONS: FormatRecommendation[] = [];

interface FormatResolutionState {
  url: string | null;
  info: VideoInfo | null;
  error: string | null;
  selectedFormatId: string | null;
}

function compactCodecLabel(codec: string | null, emptyLabel: string): string {
  if (!codec || codec === 'none') {
    return emptyLabel;
  }

  const normalized = codec.toLowerCase();
  if (normalized.includes('h.264') || normalized.includes('avc')) return 'H.264';
  if (normalized.includes('h.265') || normalized.includes('hevc') || normalized.includes('hvc1')) return 'H.265';
  if (normalized.includes('vp9') || normalized.includes('vp09')) return 'VP9';
  if (normalized.includes('av01')) return 'AV1';
  if (normalized.includes('mp4a') || normalized.includes('aac')) return 'AAC';
  if (normalized.includes('opus')) return 'Opus';

  return codec.split('.')[0].toUpperCase();
}

function getAudioCodecLabel(format: FormatRecommendation): string {
  if (format.needsMerge && !format.acodec) {
    return 'M4A audio';
  }
  return compactCodecLabel(format.acodec, 'No audio');
}

function getQueueFormatLabel(format: FormatRecommendation): string {
  return [
    format.resolution || 'Auto',
    compactCodecLabel(format.vcodec, 'Video'),
    getAudioCodecLabel(format),
  ].filter(Boolean).join(' / ');
}

export function MediaDownloadComposer() {
  const enqueueDownloads = useMediaDownloadStore((state) => state.enqueueDownloads);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [helperConnected, setHelperConnected] = useState(isDownloadAvailable());
  const [formatState, setFormatState] = useState<FormatResolutionState>({
    url: null,
    info: null,
    error: null,
    selectedFormatId: null,
  });

  useEffect(() => {
    const unsubscribe = NativeHelperClient.onStatusChange((status) => {
      setHelperConnected(status === 'connected');
    });
    return unsubscribe;
  }, []);

  const urls = useMemo(() => parseDownloadUrls(input), [input]);
  const singleUrl = urls.length === 1 && urls[0] ? urls[0] : null;
  const activeFormatState = formatState.url === singleUrl ? formatState : null;
  const videoInfo = activeFormatState?.info ?? null;
  const formatError = activeFormatState?.error ?? null;
  const selectedFormatId = activeFormatState?.selectedFormatId ?? null;
  const loadingFormats = Boolean(helperConnected && singleUrl && formatState.url !== singleUrl);
  const recommendations = videoInfo?.recommendations ?? EMPTY_FORMAT_RECOMMENDATIONS;
  const selectedFormat = useMemo(() => (
    recommendations.find((format) => format.id === selectedFormatId) ?? null
  ), [recommendations, selectedFormatId]);
  const canQueue = helperConnected
    && urls.length === 1
    && !loadingFormats
    && !formatError
    && Boolean(videoInfo)
    && (recommendations.length === 0 || Boolean(selectedFormat));

  useEffect(() => {
    if (!helperConnected || !singleUrl || formatState.url === singleUrl) {
      return undefined;
    }

    let canceled = false;

    NativeHelperClient.listFormats(singleUrl)
      .then((info) => {
        if (canceled) return;
        if (!info) {
          setFormatState({
            url: singleUrl,
            info: null,
            error: 'Could not read available formats for this URL.',
            selectedFormatId: null,
          });
          return;
        }
        setFormatState({
          url: singleUrl,
          info,
          error: null,
          selectedFormatId: info.recommendations[0]?.id ?? null,
        });
      })
      .catch((caughtError: unknown) => {
        if (canceled) return;
        setFormatState({
          url: singleUrl,
          info: null,
          error: caughtError instanceof Error ? caughtError.message : 'Could not read available formats.',
          selectedFormatId: null,
        });
      });

    return () => {
      canceled = true;
    };
  }, [formatState.url, helperConnected, singleUrl]);

  const queueUrls = useCallback(() => {
    if (!helperConnected) {
      setError('Native Helper is required for downloads.');
      return;
    }
    if (urls.length !== 1) {
      setError(urls.length === 0
        ? 'Paste one video URL.'
        : 'Paste one video URL at a time so formats can be selected.');
      return;
    }
    if (loadingFormats) {
      setError('Available formats are still loading.');
      return;
    }
    if (formatError || !videoInfo) {
      setError(formatError ?? 'Available formats could not be loaded.');
      return;
    }
    if (recommendations.length > 0 && !selectedFormat) {
      setError('Choose a resolution and codec.');
      return;
    }

    const url = urls[0];
    if (!url) {
      setError('Paste one video URL.');
      return;
    }

    const ids = enqueueDownloads([{
      url,
      formatId: selectedFormat?.id,
      formatLabel: selectedFormat ? getQueueFormatLabel(selectedFormat) : 'Helper default',
    }]);
    if (ids.length > 0) {
      setInput('');
      setError(null);
      setFormatState({
        url: null,
        info: null,
        error: null,
        selectedFormatId: null,
      });
    } else {
      setError('That URL is already queued.');
    }
  }, [
    enqueueDownloads,
    formatError,
    helperConnected,
    loadingFormats,
    recommendations.length,
    selectedFormat,
    urls,
    videoInfo,
  ]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      queueUrls();
    }
  }, [queueUrls]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData('text');
    const pastedUrls = parseDownloadUrls(pastedText);
    if (pastedUrls.length > 0) {
      setError(null);
    }
  }, []);

  return (
    <div className="fb-bubble media-download-bubble" onMouseDown={(event) => event.stopPropagation()}>
      <div className="fb-bubble-main">
        <div className="fb-bubble-prompt media-download-prompt">
          <div className="fb-bubble-row">
            <textarea
              className="fb-bubble-input media-download-input"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Paste a video URL from YouTube, TikTok, Instagram, X, Vimeo..."
              rows={3}
            />
            {input && (
              <button
                className="fb-bubble-close"
                type="button"
                onClick={() => {
                  setInput('');
                  setError(null);
                  setFormatState({
                    url: null,
                    info: null,
                    error: null,
                    selectedFormatId: null,
                  });
                }}
                title="Clear URLs"
              >
                &times;
              </button>
            )}
          </div>
        </div>
      </div>

      {helperConnected && singleUrl && (
        <div className="media-download-format-panel">
          {loadingFormats && (
            <div className="media-download-format-status">Reading available formats...</div>
          )}

          {!loadingFormats && formatError && (
            <div className="fb-audio-warning compact media-download-error">{formatError}</div>
          )}

          {!loadingFormats && videoInfo && (
            <>
              <div className="media-download-video-meta">
                <span className="media-download-video-title" title={videoInfo.title}>{videoInfo.title}</span>
                {videoInfo.uploader && (
                  <span className="media-download-video-uploader">{videoInfo.uploader}</span>
                )}
              </div>

              {recommendations.length > 0 ? (
                <div className="media-download-format-list">
                  {recommendations.map((format) => {
                    const isSelected = selectedFormatId === format.id;
                    return (
                      <button
                        key={format.id}
                        className={`media-download-format-option ${isSelected ? 'active' : ''}`}
                        type="button"
                        onClick={() => {
                          setFormatState((current) => (
                            current.url === singleUrl
                              ? { ...current, selectedFormatId: format.id }
                              : current
                          ));
                          setError(null);
                        }}
                        aria-pressed={isSelected}
                        title={format.label || getQueueFormatLabel(format)}
                      >
                        <span className="media-download-format-title">
                          {format.label || getQueueFormatLabel(format)}
                        </span>
                        <span className="media-download-format-codecs">
                          <span>{format.resolution || 'Auto'}</span>
                          <span>{compactCodecLabel(format.vcodec, 'Video')}</span>
                          <span>{getAudioCodecLabel(format)}</span>
                        </span>
                        <span className="media-download-format-meta">
                          {format.needsMerge ? 'merge' : 'single file'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="media-download-format-status">No helper recommendations; default format will be used.</div>
              )}
            </>
          )}
        </div>
      )}

      {urls.length > 1 && (
        <div className="fb-audio-warning compact media-download-error">
          Paste one video URL at a time to choose resolution and codec.
        </div>
      )}

      {error && (
        <div className="fb-audio-warning compact media-download-error">{error}</div>
      )}

      <div className="fb-bubble-bar media-download-bar">
        <div className="fb-control-stack">
          <div className="fb-pill-group media-download-pill-group">
            <span className={`fb-pill media-download-status-pill ${helperConnected ? 'ready' : 'offline'}`}>
              {helperConnected ? 'yt-dlp ready' : 'No helper'}
            </span>
            {urls.length > 0 && (
              <span className="fb-pill media-download-count-pill">
                {urls.length} URL{urls.length === 1 ? '' : 's'}
              </span>
            )}
            {singleUrl && loadingFormats && (
              <span className="fb-pill media-download-count-pill">Formats...</span>
            )}
            {singleUrl && !loadingFormats && recommendations.length > 0 && (
              <span className="fb-pill media-download-count-pill">
                {recommendations.length} format{recommendations.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="fb-selected-model-label media-download-label" title="Download URL into Media">
            Downloads
          </div>
        </div>

        <div className="fb-action-stack">
          <button
            className="fb-generate media-download-submit"
            type="button"
            disabled={!canQueue}
            onClick={queueUrls}
            title="Queue download"
          >
            <svg
              className="fb-generate-icon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M8 2v7" />
              <path d="m4.8 6.5 3.2 3.2 3.2-3.2" />
              <path d="M3 12.8h10" />
            </svg>
            <span>Download</span>
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { openNativeHelperDialog } from '../../../common/nativeHelperDialog';
import type { FormatRecommendation } from '../../../../services/nativeHelper';
import {
  compactDownloadCodecLabel,
  downloadFormatQueueLabel,
  isAudioOnlyDownloadFormat,
  pickDefaultDownloadFormat,
} from '../../../../services/mediaDiscovery/downloadFormats';
import {
  detectDownloadPlatform,
  DOWNLOAD_PLATFORM_LABELS,
  extractVideoId,
  youtubeThumbnailUrl,
} from '../../../../services/mediaDiscovery/videoUrlDownloads';
import { metadataFromVideoInfo, useMediaDownloadStore } from '../../../../stores/mediaDownloadStore';
import { useMediaUrlDownloadDialogStore } from '../../../../stores/mediaUrlDownloadDialogStore';
import { useDownloadUrlPreview } from './useDownloadUrlPreview';
import './MediaUrlDownloadDialog.css';

const EMPTY_FORMATS: FormatRecommendation[] = [];
const SKELETON_OPTION_COUNT = 4;

interface MediaUrlDownloadDialogProps {
  url: string;
  onClose: () => void;
}

function formatDuration(seconds: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = String(rounded % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

function formatFileSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024 ? `~${(megabytes / 1024).toFixed(1)} GB` : `~${Math.max(1, Math.round(megabytes))} MB`;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatOptionText(format: FormatRecommendation): { primary: string; detail: string } {
  if (isAudioOnlyDownloadFormat(format)) {
    return { primary: 'Audio', detail: format.acodec ? `${format.acodec} only` : 'Audio only' };
  }
  const fps = format.label.match(/(\d+)\s*fps/i)?.[1];
  const codec = compactDownloadCodecLabel(format.vcodec, format.needsMerge ? 'Video' : 'Best');
  return {
    primary: format.resolution && format.resolution !== '?' ? format.resolution : 'Best',
    detail: [codec, fps ? `${fps} fps` : null].filter(Boolean).join(' · '),
  };
}

export default function MediaUrlDownloadDialog({ url, onClose }: MediaUrlDownloadDialogProps) {
  const enqueueDownloads = useMediaDownloadStore((state) => state.enqueueDownloads);
  const { helperConnected, loadingFormats, info, formatError, quickMetadata, retryFormats } = useDownloadUrlPreview(url);
  const [selection, setSelection] = useState<{ url: string; formatId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const videoId = extractVideoId(url);
  const platform = detectDownloadPlatform(url);
  const sourceLabel = platform === 'generic' ? hostLabel(url) : DOWNLOAD_PLATFORM_LABELS[platform] ?? hostLabel(url);
  const formats = info?.recommendations ?? EMPTY_FORMATS;
  const selectedFormat = useMemo(() => (
    (selection?.url === url ? formats.find((format) => format.id === selection.formatId) : undefined)
    ?? pickDefaultDownloadFormat(formats)
  ), [formats, selection, url]);

  const title = info?.title || quickMetadata?.title || (loadingFormats ? '' : hostLabel(url));
  const channel = info?.uploader || quickMetadata?.channel || '';
  const duration = formatDuration(info?.duration ?? 0);
  const thumbnail = videoId ? youtubeThumbnailUrl(videoId, 'hq') : info?.thumbnail ?? '';
  const canDownload = helperConnected && !loadingFormats && !formatError && Boolean(info);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  const startDownload = useCallback(() => {
    if (!canDownload || !info) return;
    const ids = enqueueDownloads([{
      url,
      formatId: selectedFormat?.id,
      formatLabel: selectedFormat ? downloadFormatQueueLabel(selectedFormat) : 'Best available',
      metadata: {
        ...metadataFromVideoInfo(url, info),
        thumbnail: thumbnail || info.thumbnail || '',
      },
    }]);
    if (ids.length === 0) {
      setNotice('This video is already downloading.');
      return;
    }
    useMediaUrlDownloadDialogStore.getState().revealDownloads();
    onClose();
  }, [canDownload, enqueueDownloads, info, onClose, selectedFormat, thumbnail, url]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (
      event.key === 'Enter'
      && (event.target === event.currentTarget
        || (event.target as HTMLElement).closest('.media-url-download-option'))
    ) {
      event.preventDefault();
      startDownload();
    }
  }, [onClose, startDownload]);

  return (
    <div
      className="media-url-download-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        className="media-url-download-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-url-download-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="media-url-download-thumb">
          {thumbnail && !thumbnailFailed ? (
            <img src={thumbnail} alt="" referrerPolicy="no-referrer" onError={() => setThumbnailFailed(true)} />
          ) : (
            <div className="media-url-download-thumb-empty">{sourceLabel}</div>
          )}
          <span className="media-url-download-badge source">{sourceLabel}</span>
          {duration && <span className="media-url-download-badge duration">{duration}</span>}
        </div>

        <div className="media-url-download-meta">
          <h3 id="media-url-download-title" title={title}>
            {title || <span className="media-url-download-skeleton-line" />}
          </h3>
          <div className="media-url-download-channel" title={url}>{channel || hostLabel(url)}</div>
        </div>

        {!helperConnected ? (
          <div className="media-url-download-helper">
            <p>
              Downloads run on this computer through the Native Helper (yt-dlp).
              Start it to choose a resolution.
            </p>
            <button type="button" className="media-url-download-button" onClick={openNativeHelperDialog}>
              Open Native Helper
            </button>
          </div>
        ) : formatError ? (
          <div className="media-url-download-helper error">
            <p>{formatError}</p>
            <button type="button" className="media-url-download-button" onClick={retryFormats}>Retry</button>
          </div>
        ) : (
          <div className="media-url-download-formats" aria-busy={loadingFormats} aria-label="Resolution">
            {loadingFormats
              ? Array.from({ length: SKELETON_OPTION_COUNT }, (_, index) => (
                  <div key={index} className="media-url-download-option skeleton" aria-hidden="true" />
                ))
              : formats.map((format) => {
                  const text = formatOptionText(format);
                  const size = formatFileSize(format.filesize);
                  const active = format.id === selectedFormat?.id;
                  return (
                    <button
                      key={format.id}
                      type="button"
                      className={`media-url-download-option${active ? ' active' : ''}`}
                      aria-pressed={active}
                      title={format.label || downloadFormatQueueLabel(format)}
                      onClick={() => {
                        setSelection({ url, formatId: format.id });
                        setNotice(null);
                      }}
                    >
                      <span className="media-url-download-option-res">{text.primary}</span>
                      <span className="media-url-download-option-detail">{text.detail}</span>
                      {size && <span className="media-url-download-option-size">{size}</span>}
                    </button>
                  );
                })}
            {!loadingFormats && formats.length === 0 && (
              <div className="media-url-download-status">The best available format will be downloaded.</div>
            )}
          </div>
        )}

        {notice && <div className="media-url-download-status warning">{notice}</div>}

        <div className="media-url-download-actions">
          <button type="button" className="media-url-download-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="media-url-download-button primary"
            disabled={!canDownload}
            onClick={startDownload}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M8 2v7" />
              <path d="m4.8 6.5 3.2 3.2 3.2-3.2" />
              <path d="M3 12.8h10" />
            </svg>
            {loadingFormats ? 'Reading formats…' : selectedFormat ? `Download ${formatOptionText(selectedFormat).primary}` : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}

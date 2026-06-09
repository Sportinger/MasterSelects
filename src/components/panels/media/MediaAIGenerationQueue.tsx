import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  useFlashBoardActiveGenerationRecords,
  useRemoveFlashBoardActiveGenerationRecord,
  type FlashBoardActiveGenerationRecord,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import type { FlashBoardGenerationRequest } from '../../../stores/flashboardStore/types';
import { useMediaDownloadStore, type MediaDownloadJob } from '../../../stores/mediaDownloadStore';

const VISIBLE_QUEUE_STATUSES = new Set(['queued', 'processing', 'completed', 'failed', 'canceled']);
const MAX_VISIBLE_GENERATIONS = 6;
const MEDIA_QUEUE_FLY_MS = 620;

type MediaQueueItem =
  | { kind: 'generation'; id: string; createdAt: number; record: FlashBoardActiveGenerationRecord }
  | { kind: 'download'; id: string; createdAt: number; job: MediaDownloadJob };

function formatElapsedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
}

function formatElapsedRange(startedAt: number, endedAt: number): string {
  return formatElapsedDuration(endedAt - startedAt);
}

function getStatusLabel(
  status: NonNullable<FlashBoardActiveGenerationRecord['job']>['status'] | MediaDownloadJob['status'] | undefined,
  kind: MediaQueueItem['kind'] = 'generation',
): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return kind === 'download' ? 'Downloading' : 'Generating';
    case 'completed':
      return 'Ready';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return 'Pending';
  }
}

function getServiceLabel(request: FlashBoardGenerationRequest): string {
  switch (request.service) {
    case 'cloud':
      return 'Cloud';
    case 'elevenlabs':
      return 'ElevenLabs';
    case 'evolink':
      return 'EvoLink';
    case 'kieai':
      return 'Kie.ai';
    case 'piapi':
      return 'PiAPI';
    case 'suno':
      return 'Suno';
    default:
      return request.service;
  }
}

function getPlatformLabel(platform: string): string {
  switch (platform) {
    case 'youtube':
      return 'YouTube';
    case 'tiktok':
      return 'TikTok';
    case 'instagram':
      return 'Instagram';
    case 'twitter':
      return 'X/Twitter';
    case 'facebook':
      return 'Facebook';
    case 'reddit':
      return 'Reddit';
    case 'vimeo':
      return 'Vimeo';
    case 'twitch':
      return 'Twitch';
    case 'dailymotion':
      return 'Dailymotion';
    default:
      return 'Download';
  }
}

function getOutputLabel(request: FlashBoardGenerationRequest): string {
  if (request.outputType === 'image') {
    return 'Image';
  }
  if (request.outputType === 'audio' || request.service === 'elevenlabs' || request.service === 'suno') {
    return 'Audio';
  }
  return 'Video';
}

function getPreviewAspectRatio(request: FlashBoardGenerationRequest): string {
  if (request.outputType === 'audio' || request.service === 'elevenlabs' || request.service === 'suno') {
    return '2.4 / 1';
  }

  const [width, height] = (request.aspectRatio ?? '16:9').split(':').map((part) => Number(part));
  if (width > 0 && height > 0) {
    return `${width} / ${height}`;
  }

  return request.outputType === 'image' ? '1 / 1' : '16 / 9';
}

function getGeneratedPreviewUrl(mediaFile: MediaFile | undefined): string | undefined {
  if (!mediaFile) {
    return undefined;
  }

  if (mediaFile.thumbnailUrl) {
    return mediaFile.thumbnailUrl;
  }

  return mediaFile.type === 'image' ? mediaFile.url : undefined;
}

function getMetaLabel(request: FlashBoardGenerationRequest): string {
  const parts = [getServiceLabel(request)];

  if (request.duration && getOutputLabel(request) !== 'Audio') {
    parts.push(`${request.duration}s`);
  }
  if (request.aspectRatio && getOutputLabel(request) !== 'Audio') {
    parts.push(request.aspectRatio);
  }
  if (request.imageSize) {
    parts.push(request.imageSize);
  }

  return parts.join(' · ');
}

function getDownloadMetaLabel(job: MediaDownloadJob): string {
  const parts = [getPlatformLabel(job.platform)];
  if (job.formatLabel) {
    parts.push(job.formatLabel);
  }
  if (job.durationSeconds > 0) {
    parts.push(formatElapsedDuration(job.durationSeconds * 1000));
  }
  if (job.speed && job.status === 'processing') {
    parts.push(job.speed);
  }
  if (job.fileName && job.status === 'completed') {
    parts.push(job.fileName);
  }

  return parts.join(' - ');
}

function getMediaPanelTarget(mediaFileId: string): HTMLElement | null {
  if (typeof document === 'undefined' || typeof CSS === 'undefined') {
    return null;
  }

  return document.querySelector<HTMLElement>(`[data-media-panel-anim-id="${CSS.escape(mediaFileId)}"]`);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function waitForAnimation(animation: Animation): Promise<void> {
  return animation.finished.then(() => undefined, () => undefined);
}

async function animateCardToMediaTarget(source: HTMLElement, mediaFileId: string): Promise<void> {
  const target = getMediaPanelTarget(mediaFileId);
  if (!target || typeof document === 'undefined' || prefersReducedMotion()) {
    target?.classList.add('media-ai-generation-target-pulse');
    window.setTimeout(() => target?.classList.remove('media-ai-generation-target-pulse'), MEDIA_QUEUE_FLY_MS);
    return;
  }

  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (sourceRect.width < 1 || sourceRect.height < 1 || targetRect.width < 1 || targetRect.height < 1) {
    return;
  }

  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.add('media-ai-generation-card-fly-clone');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.left = `${sourceRect.left}px`;
  clone.style.top = `${sourceRect.top}px`;
  clone.style.width = `${sourceRect.width}px`;
  clone.style.height = `${sourceRect.height}px`;
  document.body.appendChild(clone);
  source.classList.add('is-flying');

  const sourceCenterX = sourceRect.left + (sourceRect.width / 2);
  const sourceCenterY = sourceRect.top + (sourceRect.height / 2);
  const targetCenterX = targetRect.left + (targetRect.width / 2);
  const targetCenterY = targetRect.top + (targetRect.height / 2);
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;
  const scale = Math.max(0.2, Math.min(0.82, Math.min(
    targetRect.width / sourceRect.width,
    targetRect.height / sourceRect.height
  )));
  const midScale = Math.max(scale + ((1 - scale) * 0.34), 0.62);
  const pulseTimer = window.setTimeout(() => {
    target.classList.add('media-ai-generation-target-pulse');
  }, MEDIA_QUEUE_FLY_MS * 0.62);

  try {
    const animation = clone.animate(
      [
        {
          opacity: 1,
          transform: 'translate3d(0, 0, 0) scale(1)',
        },
        {
          opacity: 0.96,
          transform: `translate3d(${dx * 0.58}px, ${dy * 0.18}px, 0) scale(${midScale})`,
          offset: 0.42,
        },
        {
          opacity: 0,
          transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`,
        },
      ],
      {
        duration: MEDIA_QUEUE_FLY_MS,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      }
    );

    await waitForAnimation(animation);
  } finally {
    window.clearTimeout(pulseTimer);
    clone.remove();
    source.classList.remove('is-flying');
    window.setTimeout(() => target.classList.remove('media-ai-generation-target-pulse'), 700);
  }
}

function MediaAIGenerationQueueImpl() {
  const generationRecords = useFlashBoardActiveGenerationRecords();
  const removeGenerationRecord = useRemoveFlashBoardActiveGenerationRecord();
  const downloadJobs = useMediaDownloadStore((state) => state.jobs);
  const dismissDownloadJob = useMediaDownloadStore((state) => state.dismissJob);
  const retryDownloadJob = useMediaDownloadStore((state) => state.retryJob);
  const mediaFiles = useMediaStore((state) => state.files);
  const mediaFilesById = useMemo(() => new Map(mediaFiles.map((file) => [file.id, file])), [mediaFiles]);
  const [now, setNow] = useState(() => Date.now());
  const [flyingItemIds, setFlyingItemIds] = useState<Set<string>>(() => new Set());
  const flyingItemIdsRef = useRef<Set<string>>(new Set());

  const generationItems = useMemo<MediaQueueItem[]>(() => generationRecords
    .filter((record) => (
      record.request
      && VISIBLE_QUEUE_STATUSES.has(record.job?.status ?? '')
    ))
    .map((record) => ({
      kind: 'generation' as const,
      id: record.id,
      createdAt: record.createdAt,
      record,
    })), [generationRecords]);

  const downloadItems = useMemo<MediaQueueItem[]>(() => downloadJobs
    .filter((job) => VISIBLE_QUEUE_STATUSES.has(job.status))
    .map((job) => ({
      kind: 'download' as const,
      id: job.id,
      createdAt: job.createdAt,
      job,
    })), [downloadJobs]);

  const items = useMemo(() => [...generationItems, ...downloadItems]
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_VISIBLE_GENERATIONS), [downloadItems, generationItems]);

  const hasRunningItem = items.some((item) => {
    const status = item.kind === 'generation' ? item.record.job?.status : item.job.status;
    return status === 'queued' || status === 'processing';
  });

  useEffect(() => {
    if (!hasRunningItem) {
      return undefined;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningItem]);

  const handleCompletedLocate = useCallback(async (
    itemId: string,
    mediaFileId: string | undefined,
    source: HTMLElement,
    removeAfterLocate: () => void,
  ) => {
    if (!mediaFileId || flyingItemIdsRef.current.has(itemId)) {
      return;
    }

    flyingItemIdsRef.current.add(itemId);
    setFlyingItemIds((current) => new Set(current).add(itemId));
    try {
      await animateCardToMediaTarget(source, mediaFileId);
      removeAfterLocate();
    } finally {
      flyingItemIdsRef.current.delete(itemId);
      setFlyingItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="media-ai-generation-queue" aria-label="Media task queue">
      {items.map((item) => {
        const isDownload = item.kind === 'download';
        const record = item.kind === 'generation' ? item.record : null;
        const job = item.kind === 'download' ? item.job : null;
        const request = record?.request;
        if (!isDownload && !request) return null;

        const status = isDownload ? job!.status : record!.job?.status;
        const rawProgress = isDownload ? job!.progress : record!.job?.progress;
        const progress = typeof rawProgress === 'number'
          ? Math.max(0, Math.min(1, rawProgress))
          : null;
        const mediaFileId = isDownload ? job!.mediaFileId : record!.result?.mediaFileId;
        const generatedMedia = mediaFileId
          ? mediaFilesById.get(mediaFileId)
          : undefined;
        const previewUrl = isDownload
          ? (job!.thumbnail || getGeneratedPreviewUrl(generatedMedia))
          : status === 'completed'
            ? getGeneratedPreviewUrl(generatedMedia)
            : undefined;
        const startedAt = isDownload ? job!.startedAt : record!.job?.startedAt;
        const completedAt = isDownload ? job!.completedAt : record!.job?.completedAt;
        const hasGenerationTimer = (status === 'processing' || status === 'completed') && Boolean(startedAt);
        const queueTimerLabel = formatElapsedRange(item.createdAt, hasGenerationTimer && startedAt ? startedAt : now);
        const generationTimerLabel = hasGenerationTimer && startedAt
          ? formatElapsedRange(startedAt, completedAt ?? now)
          : null;
        const progressLabel = progress !== null ? `${Math.round(progress * 100)}%` : null;
        const canFlyToMedia = status === 'completed' && Boolean(mediaFileId);
        const canDismiss = status === 'failed' || status === 'canceled' || (status === 'completed' && !canFlyToMedia);
        const itemId = item.id;
        const cardClassName = [
          'media-ai-generation-card',
          isDownload ? 'download' : 'generation',
          status ?? 'pending',
          canFlyToMedia ? 'can-locate' : '',
          flyingItemIds.has(itemId) ? 'is-flying' : '',
        ].filter(Boolean).join(' ');
        const removeItem = () => {
          if (isDownload) {
            dismissDownloadJob(itemId);
          } else {
            removeGenerationRecord(itemId);
          }
        };
        const handleClick = (event: MouseEvent<HTMLDivElement>) => {
          if (canFlyToMedia) {
            void handleCompletedLocate(itemId, mediaFileId, event.currentTarget, removeItem);
          }
        };
        const handleMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
          if (canFlyToMedia) {
            void handleCompletedLocate(itemId, mediaFileId, event.currentTarget, removeItem);
          }
        };
        const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (!canFlyToMedia || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
          }

          event.preventDefault();
          void handleCompletedLocate(itemId, mediaFileId, event.currentTarget, removeItem);
        };
        const title = isDownload ? job!.title : request!.prompt;
        const outputLabel = isDownload ? 'Download' : getOutputLabel(request!);
        const metaLabel = isDownload ? getDownloadMetaLabel(job!) : getMetaLabel(request!);
        const aspectRatio = isDownload ? '16 / 9' : getPreviewAspectRatio(request!);
        const error = isDownload ? job!.error : record!.job?.error;

        return (
          <div
            key={itemId}
            className={cardClassName}
            onClick={canFlyToMedia ? handleClick : undefined}
            onMouseEnter={canFlyToMedia ? handleMouseEnter : undefined}
            onKeyDown={canFlyToMedia ? handleKeyDown : undefined}
            role={canFlyToMedia ? 'button' : undefined}
            tabIndex={canFlyToMedia ? 0 : undefined}
            title={canFlyToMedia ? 'Show media in Media panel' : undefined}
          >
            <div
              className={`media-ai-generation-preview ${previewUrl ? 'has-thumbnail' : ''}`}
              style={{ aspectRatio }}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="" draggable={false} />
              ) : null}
              <span>{outputLabel}</span>
              {(status === 'queued' || status === 'processing') && (
                <span className="media-ai-generation-pulse" aria-hidden="true" />
              )}
            </div>
            <div className="media-ai-generation-body">
              <div className="media-ai-generation-status-row">
                <span className={`media-ai-generation-status ${status ?? 'pending'}`}>
                  {getStatusLabel(status, item.kind)}
                </span>
                <div
                  className={`media-ai-generation-timers ${generationTimerLabel ? 'has-generation' : 'pending-only'}`}
                  aria-label={generationTimerLabel
                    ? `Generation time ${generationTimerLabel}, queue time ${queueTimerLabel}`
                    : `Queue time ${queueTimerLabel}`}
                >
                  {generationTimerLabel ? (
                    <span className="media-ai-generation-time media-ai-generation-time-generation" title="Generation time">
                      {generationTimerLabel}
                    </span>
                  ) : null}
                  <span className="media-ai-generation-time media-ai-generation-time-pending" title="Queue time">
                    {generationTimerLabel ? `queued ${queueTimerLabel}` : queueTimerLabel}
                  </span>
                </div>
              </div>
              <div className="media-ai-generation-prompt" title={title}>
                {title || (isDownload ? job!.url : 'Untitled generation')}
              </div>
              <div className="media-ai-generation-meta">
                {metaLabel}
              </div>
              {progress !== null && (
                <div className="media-ai-generation-progress" aria-label={`${outputLabel} progress ${progressLabel}`}>
                  <span style={{ width: progressLabel ?? '0%' }} />
                </div>
              )}
              {status === 'failed' && error && (
                <div className="media-ai-generation-error" title={error}>
                  {error}
                </div>
              )}
            </div>
            {status === 'failed' && isDownload && (
              <button
                className="media-ai-generation-dismiss media-ai-generation-retry"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  retryDownloadJob(itemId);
                }}
                title="Retry download"
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M12.2 6.3A4.4 4.4 0 1 0 13 9" />
                  <path d="M12.2 2.8v3.5H8.7" />
                </svg>
              </button>
            )}
            {canDismiss && (
              <button
                className="media-ai-generation-dismiss"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeItem();
                }}
                title={isDownload ? 'Dismiss download' : 'Dismiss generation'}
              >
                &times;
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Memoized: the queue subscribes to its own stores, so it shouldn't re-render
// just because the (heavy) expanded tray parent re-renders (#199).
export const MediaAIGenerationQueue = memo(MediaAIGenerationQueueImpl);

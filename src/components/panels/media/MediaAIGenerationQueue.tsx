import { useEffect, useMemo, useState } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardGenerationRequest, FlashBoardNode } from '../../../stores/flashboardStore/types';

const VISIBLE_QUEUE_STATUSES = new Set(['queued', 'processing', 'failed', 'canceled']);
const MAX_VISIBLE_GENERATIONS = 6;

function formatElapsed(startedAt: number | undefined, createdAt: number, now: number): string {
  const anchor = startedAt ?? createdAt;
  const totalSeconds = Math.max(0, Math.floor((now - anchor) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
}

function getStatusLabel(status: NonNullable<FlashBoardNode['job']>['status'] | undefined): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Generating';
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

export function MediaAIGenerationQueue() {
  const boards = useFlashBoardStore((state) => state.boards);
  const removeNode = useFlashBoardStore((state) => state.removeNode);
  const [now, setNow] = useState(() => Date.now());

  const nodes = useMemo(() => boards
    .flatMap((board) => board.nodes)
    .filter((node) => (
      node.kind === 'generation'
      && node.request
      && VISIBLE_QUEUE_STATUSES.has(node.job?.status ?? '')
    ))
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_VISIBLE_GENERATIONS), [boards]);

  const hasRunningGeneration = nodes.some((node) => {
    const status = node.job?.status;
    return status === 'queued' || status === 'processing';
  });

  useEffect(() => {
    if (!hasRunningGeneration) {
      return undefined;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningGeneration]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="media-ai-generation-queue" aria-label="AI generation queue">
      {nodes.map((node) => {
        const request = node.request;
        if (!request) {
          return null;
        }

        const status = node.job?.status;
        const progress = typeof node.job?.progress === 'number'
          ? Math.max(0, Math.min(1, node.job.progress))
          : null;
        const progressLabel = progress !== null ? `${Math.round(progress * 100)}%` : null;
        const canDismiss = status === 'failed' || status === 'canceled';

        return (
          <div key={node.id} className={`media-ai-generation-card ${status ?? 'pending'}`}>
            <div className="media-ai-generation-preview" style={{ aspectRatio: getPreviewAspectRatio(request) }}>
              <span>{getOutputLabel(request)}</span>
              {(status === 'queued' || status === 'processing') && (
                <span className="media-ai-generation-pulse" aria-hidden="true" />
              )}
            </div>
            <div className="media-ai-generation-body">
              <div className="media-ai-generation-status-row">
                <span className={`media-ai-generation-status ${status ?? 'pending'}`}>
                  {getStatusLabel(status)}
                </span>
                <span className="media-ai-generation-time">
                  {formatElapsed(node.job?.startedAt, node.createdAt, now)}
                </span>
              </div>
              <div className="media-ai-generation-prompt" title={request.prompt}>
                {request.prompt || 'Untitled generation'}
              </div>
              <div className="media-ai-generation-meta">
                {getMetaLabel(request)}
              </div>
              {progress !== null && (
                <div className="media-ai-generation-progress" aria-label={`Generation progress ${progressLabel}`}>
                  <span style={{ width: progressLabel ?? '0%' }} />
                </div>
              )}
              {status === 'failed' && node.job?.error && (
                <div className="media-ai-generation-error" title={node.job.error}>
                  {node.job.error}
                </div>
              )}
            </div>
            {canDismiss && (
              <button
                className="media-ai-generation-dismiss"
                type="button"
                onClick={() => removeNode(node.id)}
                title="Dismiss generation"
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

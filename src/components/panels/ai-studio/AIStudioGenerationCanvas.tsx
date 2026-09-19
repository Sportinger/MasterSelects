import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { getCatalogEntry } from '../../../services/flashboard/FlashBoardModelCatalog';
import { flashBoardMediaBridge } from '../../../services/flashboard/FlashBoardMediaBridge';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationMetadata,
  FlashBoardGenerationOutput,
  FlashBoardGenerationRequest,
  FlashBoardJobState,
  FlashBoardResult,
} from '../../../stores/flashboardStore/types';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import './AIStudioGenerationCanvas.css';

interface GenerationTile {
  id: string;
  mediaFile?: MediaFile;
  output?: FlashBoardGenerationOutput;
  record: FlashBoardActiveGenerationRecord;
  result?: FlashBoardResult;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
    : `${remainingSeconds}s`;
}

function formatStatus(status: FlashBoardJobState['status'] | undefined): string {
  switch (status) {
    case 'queued': return 'Queued';
    case 'processing': return 'Generating';
    case 'completed': return 'Ready';
    case 'failed': return 'Failed';
    case 'canceled': return 'Canceled';
    default: return 'Preparing';
  }
}

function getModelName(record: FlashBoardActiveGenerationRecord): string {
  const request = record.request;
  if (!request) return 'Model';
  return getCatalogEntry(request.service, request.providerId)?.name.replace(' (Kie.ai)', '')
    ?? request.providerId;
}

function getPreviewUrl(tile: GenerationTile): string | undefined {
  const media = tile.mediaFile;
  if (media?.type === 'image') return media.url;
  if (media?.thumbnailUrl) return media.thumbnailUrl;
  return tile.output?.artworkUrl
    ?? tile.output?.previewUrl
    ?? (tile.record.request?.outputType === 'image' ? tile.output?.downloadUrl : undefined);
}

function getOutputType(tile: GenerationTile): 'image' | 'video' | 'audio' {
  const mediaType = tile.mediaFile?.type ?? tile.result?.mediaType ?? tile.output?.mediaType;
  if (mediaType === 'image' || mediaType === 'audio') return mediaType;
  return tile.record.request?.outputType === 'image'
    ? 'image'
    : tile.record.request?.outputType === 'audio' ? 'audio' : 'video';
}

function getAspectGlyphStyle(value: string): CSSProperties {
  const [width, height] = value.split(':').map(Number);
  if (!width || !height) return {};
  const ratio = Math.min(3.5, Math.max(0.3, width / height));
  const glyphWidth = ratio >= 1 ? 38 : Math.max(14, 38 * ratio);
  const glyphHeight = ratio >= 1 ? Math.max(14, 38 / ratio) : 38;
  return { width: glyphWidth, height: glyphHeight };
}

function getRecordTiles(
  record: FlashBoardActiveGenerationRecord,
  mediaById: Map<string, MediaFile>,
): GenerationTile[] {
  const results = record.results?.length
    ? record.results
    : record.result ? [record.result] : [];
  if (results.length === 0) {
    const output = record.outputs?.[0];
    const mediaFileId = output?.mediaFileId;
    return [{
      id: record.id,
      mediaFile: mediaFileId ? mediaById.get(mediaFileId) : undefined,
      output,
      record,
    }];
  }

  return results.map((result, index) => {
    const output = result.outputId
      ? record.outputs?.find((candidate) => candidate.id === result.outputId)
      : record.outputs?.[index];
    return {
      id: `${record.id}:${result.outputId ?? result.mediaFileId}`,
      mediaFile: mediaById.get(result.mediaFileId),
      output,
      record,
      result,
    };
  });
}

function requestFromMetadata(metadata: FlashBoardGenerationMetadata): FlashBoardGenerationRequest {
  return {
    service: metadata.service ?? 'cloud',
    providerId: metadata.providerId,
    version: metadata.version,
    outputType: metadata.outputType ?? metadata.mediaType,
    mode: metadata.mode,
    originalPrompt: metadata.originalPrompt,
    prompt: metadata.prompt,
    negativePrompt: metadata.negativePrompt,
    duration: metadata.duration,
    aspectRatio: metadata.aspectRatio,
    imageSize: metadata.imageSize,
    generateAudio: metadata.generateAudio,
    multiShots: metadata.multiShots,
    multiPrompt: metadata.multiPrompt,
    voiceId: metadata.voiceId,
    voiceName: metadata.voiceName,
    languageOverride: metadata.languageOverride,
    languageCode: metadata.languageCode,
    outputFormat: metadata.outputFormat,
    webSearch: metadata.webSearch,
    returnLastFrame: metadata.returnLastFrame,
    voiceSettings: metadata.voiceSettings,
    sunoCustomMode: metadata.sunoCustomMode,
    sunoInstrumental: metadata.sunoInstrumental,
    sunoStyle: metadata.sunoStyle,
    sunoTitle: metadata.sunoTitle,
    sunoNegativeTags: metadata.sunoNegativeTags,
    sunoVocalGender: metadata.sunoVocalGender,
    sunoStyleWeight: metadata.sunoStyleWeight,
    sunoWeirdnessConstraint: metadata.sunoWeirdnessConstraint,
    sunoAudioWeight: metadata.sunoAudioWeight,
    startMediaFileId: metadata.startMediaFileId,
    endMediaFileId: metadata.endMediaFileId,
    referenceMediaFileIds: metadata.referenceMediaFileIds,
  };
}

function getDurableMediaTiles(
  mediaFiles: MediaFile[],
  representedMediaIds: Set<string>,
  activeWorkspaceId: string,
  legacyWorkspaceId: string | undefined,
): GenerationTile[] {
  return mediaFiles.flatMap((mediaFile) => {
    if (representedMediaIds.has(mediaFile.id)) return [];
    const metadata = flashBoardMediaBridge.getMetadata(mediaFile.id);
    if (!metadata) return [];
    const workspaceId = metadata.workspaceId ?? legacyWorkspaceId;
    if (workspaceId !== activeWorkspaceId) return [];
    const createdAt = new Date(metadata.createdAt).getTime();
    const completedAt = Number.isFinite(createdAt) ? createdAt : Date.now();
    const generationElapsedMs = typeof metadata.generationElapsedMs === 'number'
      && Number.isFinite(metadata.generationElapsedMs)
      ? Math.max(0, metadata.generationElapsedMs)
      : undefined;
    const record: FlashBoardActiveGenerationRecord = {
      id: `generated-media:${mediaFile.id}`,
      kind: 'generation',
      workspaceId,
      createdAt: completedAt,
      updatedAt: completedAt,
      request: requestFromMetadata(metadata),
      job: {
        status: 'completed',
        startedAt: generationElapsedMs === undefined ? undefined : completedAt - generationElapsedMs,
        completedAt,
      },
      result: {
        mediaFileId: mediaFile.id,
        mediaType: metadata.mediaType
          ?? (mediaFile.type === 'audio' || mediaFile.type === 'image' ? mediaFile.type : 'video'),
        duration: mediaFile.duration,
        width: mediaFile.width,
        height: mediaFile.height,
      },
    };
    return [{
      id: record.id,
      mediaFile,
      record,
      result: record.result,
    }];
  });
}

function GenerationPreview({ tile }: { tile: GenerationTile }) {
  const previewUrl = getPreviewUrl(tile);
  const outputType = getOutputType(tile);
  if (previewUrl) return <img alt="" draggable={false} src={previewUrl} />;
  if (outputType === 'video' && tile.mediaFile?.url) {
    return <video aria-label="Generated video" muted preload="metadata" src={tile.mediaFile.url} />;
  }
  const status = tile.record.job?.status;
  const aspectRatio = tile.record.request?.aspectRatio;
  const isGenerating = status === 'draft' || status === 'queued' || status === 'processing';
  if (isGenerating && aspectRatio) {
    const isAuto = !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(aspectRatio);
    return (
      <div className="ai-studio-tile-aspect-placeholder" aria-label={`Aspect ratio ${aspectRatio}`}>
        <span
          className={isAuto ? 'is-auto' : ''}
          style={isAuto ? undefined : getAspectGlyphStyle(aspectRatio)}
        />
      </div>
    );
  }
  return (
    <div className={`ai-studio-tile-placeholder ${outputType}`} aria-hidden="true">
      <span>{outputType === 'audio' ? '♪' : outputType === 'video' ? '▶' : '✦'}</span>
    </div>
  );
}

function GenerationPrompt({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedResetRef.current !== null) window.clearTimeout(copiedResetRef.current);
  }, []);

  const copyPrompt = () => {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      if (copiedResetRef.current !== null) window.clearTimeout(copiedResetRef.current);
      copiedResetRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedResetRef.current = null;
      }, 1200);
    }).catch(() => setCopied(false));
  };

  return (
    <button
      aria-expanded={expanded}
      className={`ai-studio-generation-prompt ${expanded ? 'is-expanded' : ''} ${copied ? 'is-copied' : ''}`}
      onBlur={() => setExpanded(false)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        copyPrompt();
      }}
      onFocus={() => setExpanded(true)}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      title={copied ? 'Copied to clipboard' : `${prompt} — double-click to copy`}
      type="button"
    >
      {prompt}
    </button>
  );
}

interface AIStudioGenerationCanvasProps {
  tileSize?: number;
}

export function AIStudioGenerationCanvas({ tileSize = 260 }: AIStudioGenerationCanvasProps) {
  const records = useFlashBoardStore((state) => state.activeGenerationRecords);
  const activeWorkspaceId = useFlashBoardStore((state) => state.activeAIWorkspaceId);
  const legacyWorkspaceId = useFlashBoardStore((state) => (
    state.aiWorkspaces.find((workspace) => workspace.kind === 'generation')?.id
  ));
  const mediaFiles = useMediaStore((state) => state.files);
  const setSourceMonitorFile = useMediaStore((state) => state.setSourceMonitorFile);
  const [now, setNow] = useState(() => Date.now());
  const mediaById = useMemo(
    () => new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile])),
    [mediaFiles],
  );
  const visibleRecords = useMemo(() => records
    .filter((record) => record.request && (!record.workspaceId || record.workspaceId === activeWorkspaceId))
    .toSorted((left, right) => right.createdAt - left.createdAt), [activeWorkspaceId, records]);
  const tiles = useMemo(() => {
    const recordTiles = visibleRecords.flatMap((record) => getRecordTiles(record, mediaById));
    const representedMediaIds = new Set(
      recordTiles.map((tile) => tile.mediaFile?.id).filter((id): id is string => Boolean(id)),
    );
    return [
      ...recordTiles,
      ...getDurableMediaTiles(
        mediaFiles,
        representedMediaIds,
        activeWorkspaceId,
        legacyWorkspaceId,
      ),
    ].toSorted((left, right) => right.record.createdAt - left.record.createdAt);
  }, [activeWorkspaceId, legacyWorkspaceId, mediaById, mediaFiles, visibleRecords]);
  const hasRunningGeneration = visibleRecords.some((record) => (
    record.job?.status === 'queued' || record.job?.status === 'processing' || record.job?.status === 'draft'
  ));

  useEffect(() => {
    if (!hasRunningGeneration) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasRunningGeneration]);

  if (tiles.length === 0) return null;

  return (
    <div className="ai-studio-generation-canvas" aria-label="AI generations">
      <div
        className="ai-studio-generation-grid"
        style={{ '--ai-studio-tile-size': `${tileSize}px` } as CSSProperties}
      >
        {tiles.map((tile) => {
          const { record } = tile;
          const request = record.request!;
          const status = record.job?.status;
          const startedAt = record.job?.startedAt;
          const endedAt = record.job?.completedAt ?? now;
          const elapsed = startedAt === undefined
            ? status === 'completed' ? null : formatElapsed(endedAt - record.createdAt)
            : formatElapsed(endedAt - startedAt);
          const meta = [
            request.aspectRatio,
            request.imageSize,
            request.duration ? `${request.duration}s` : undefined,
          ].filter(Boolean);
          const progress = typeof record.job?.progress === 'number'
            ? Math.max(0, Math.min(1, record.job.progress))
            : null;
          const prompt = request.prompt || request.sunoStyle || 'Untitled generation';
          const canDrag = Boolean(tile.mediaFile && !tile.mediaFile.isImporting);
          const canOpenInSourceMonitor = canDrag;
          const handleDragStart = (event: DragEvent<HTMLElement>) => {
            if (!tile.mediaFile || tile.mediaFile.isImporting) {
              event.preventDefault();
              return;
            }
            flashBoardMediaBridge.startDragToTimeline(event.nativeEvent, tile.mediaFile.id);
          };
          const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
            if (!canOpenInSourceMonitor || !tile.mediaFile) return;
            event.stopPropagation();
            setSourceMonitorFile(tile.mediaFile.id);
          };

          return (
            <article
              className={`ai-studio-generation-tile ${status ?? 'draft'} ${canDrag ? 'is-draggable' : ''}`}
              draggable={canDrag}
              key={tile.id}
              onDoubleClick={handleDoubleClick}
              onDragEnd={() => flashBoardMediaBridge.endDrag()}
              onDragStart={handleDragStart}
              title={canOpenInSourceMonitor
                ? 'Double-click to open in Source Monitor; drag to the timeline'
                : undefined}
            >
              <div className="ai-studio-generation-tile-preview">
                <GenerationPreview tile={tile} />
                <div className="ai-studio-generation-tile-topline">
                  <span className={`ai-studio-generation-tile-status ${status ?? 'draft'}`}>
                    {formatStatus(status)}
                  </span>
                  {elapsed && <time title="Elapsed time">{elapsed}</time>}
                </div>
                <div className="ai-studio-generation-tile-overlay-pills">
                  <span title={getModelName(record)}>{getModelName(record)}</span>
                  {meta.map((item) => <span key={item}>{item}</span>)}
                </div>
                {(status === 'queued' || status === 'processing' || status === 'draft') && (
                  <span className="ai-studio-generation-tile-pulse" aria-hidden="true" />
                )}
              </div>
              <div className="ai-studio-generation-tile-body">
                <GenerationPrompt prompt={prompt} />
                {progress !== null && status !== 'completed' && (
                  <div className="ai-studio-generation-tile-progress" aria-label={`${Math.round(progress * 100)}%`}>
                    <span style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                )}
                {status === 'failed' && record.job?.error && (
                  <div className="ai-studio-generation-tile-error" title={record.job.error}>
                    {record.job.error}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

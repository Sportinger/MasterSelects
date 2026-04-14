import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardNode as FlashBoardNodeType } from '../../../stores/flashboardStore/types';
import { useMediaStore } from '../../../stores/mediaStore';

interface FlashBoardNodeProps {
  node: FlashBoardNodeType;
  isSelected: boolean;
  zoom: number;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
}

export function FlashBoardNode({ node, isSelected, zoom, onContextMenu }: FlashBoardNodeProps) {
  const moveNode = useFlashBoardStore((s) => s.moveNode);
  const setSelectedNodes = useFlashBoardStore((s) => s.setSelectedNodes);
  const openComposer = useFlashBoardStore((s) => s.openComposer);

  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const status = node.job?.status ?? (node.kind === 'reference' ? 'completed' : 'draft');
  const prompt = node.request?.prompt;
  const provider = node.request?.providerId;
  const durationLabel = node.request?.duration ? `${node.request.duration}s` : null;
  const modeLabel = node.request?.mode ? node.request.mode.toUpperCase() : null;
  const resolutionLabel = node.request?.imageSize ?? null;
  const aspectRatioLabel = node.request?.aspectRatio ?? null;
  const detailTokens = [modeLabel, durationLabel, resolutionLabel, aspectRatioLabel].filter(Boolean) as string[];
  const isActive = status === 'queued' || status === 'processing';
  const startedAt = node.job?.startedAt;
  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const elapsedLabel = elapsedMs >= 60_000
    ? `${Math.floor(elapsedMs / 60_000)}m ${Math.floor((elapsedMs % 60_000) / 1000)}s`
    : `${Math.floor(elapsedMs / 1000)}s`;
  const statusLabel =
    status === 'queued'
      ? 'Queued'
      : status === 'processing'
        ? 'Generating'
        : status === 'completed'
          ? 'Done'
          : status === 'failed'
            ? 'Failed'
            : status === 'canceled'
              ? 'Canceled'
              : 'Draft';

  useEffect(() => {
    if (!isActive || !startedAt) {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isActive, startedAt]);

  // Get thumbnail for reference/completed nodes
  const mediaFileId = node.result?.mediaFileId;
  const thumbnailUrl = useMediaStore((s) => {
    if (!mediaFileId) return undefined;
    const file = s.files.find((f) => f.id === mediaFileId);
    return file?.thumbnailUrl || file?.url;
  });
  const mediaName = useMediaStore((s) => {
    if (!mediaFileId) return undefined;
    return s.files.find((f) => f.id === mediaFileId)?.name;
  });
  const isReference = node.kind === 'reference';
  const hasPreview = Boolean(thumbnailUrl);
  const previewTitle = isReference ? mediaName || 'Reference asset' : prompt || 'No prompt yet';
  const showMeta = Boolean(provider || detailTokens.length > 0 || startedAt || status === 'failed');

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    setSelectedNodes([node.id]);

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.position.x,
      nodeY: node.position.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - dragRef.current.startX) / zoom;
      const dy = (ev.clientY - dragRef.current.startY) / zoom;
      moveNode(node.id, {
        x: dragRef.current.nodeX + dx,
        y: dragRef.current.nodeY + dy,
      });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [node.id, node.position.x, node.position.y, zoom, moveNode, setSelectedNodes]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.kind === 'generation') {
      openComposer(node.id);
    }
  }, [node.id, node.kind, openComposer]);

  const handleRightClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNodes([node.id]);
    onContextMenu(e, node.id);
  }, [node.id, setSelectedNodes, onContextMenu]);

  // DnD: allow dragging completed/reference nodes to timeline
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!mediaFileId) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.dataTransfer.setData('application/x-media-file-id', mediaFileId);
    e.dataTransfer.effectAllowed = 'copy';
  }, [mediaFileId]);

  const handleNodeDragStart = useCallback((e: React.DragEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.flashboard-node-drag-handle')) {
      return;
    }
    e.preventDefault();
  }, []);

  return (
    <div
      className={`flashboard-node ${status} ${isSelected ? 'selected' : ''} ${isReference ? 'reference' : ''} ${hasPreview ? 'has-preview' : ''}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleRightClick}
      onDragStart={handleNodeDragStart}
    >
      <div className="flashboard-node-status" />
      <div className="flashboard-node-body">
        {hasPreview ? (
          <>
            {thumbnailUrl && (
              <div className="flashboard-node-preview">
                <img className="flashboard-node-thumbnail" src={thumbnailUrl} alt="" draggable={false} />
              </div>
            )}
            {mediaFileId && (
              <div
                className="flashboard-node-drag-handle"
                title="Drag to timeline"
                draggable
                onDragStart={handleDragStart}
                onMouseDown={(e) => e.stopPropagation()}
              >
                +
              </div>
            )}
            <div className="flashboard-node-overlay">
              <div className="flashboard-node-overlay-body">
                <div className={`flashboard-node-prompt ${!prompt && !isReference ? 'empty' : ''}`}>
                  {previewTitle}
                </div>
                {showMeta && (
                  <>
                    {provider && !isReference && (
                      <div className="flashboard-node-provider">{provider}</div>
                    )}
                    {detailTokens.length > 0 && (
                      <div className="flashboard-node-details">
                        {detailTokens.map((token) => (
                          <span key={token} className="flashboard-node-detail-pill">{token}</span>
                        ))}
                      </div>
                    )}
                    {(isActive || status === 'completed' || status === 'failed' || status === 'canceled') && (
                      <div className="flashboard-node-meta">
                        <span>{statusLabel}</span>
                        {startedAt && <span>{elapsedLabel}</span>}
                      </div>
                    )}
                    {status === 'failed' && node.job?.error && (
                      <div className="flashboard-node-error" title={node.job.error}>
                        {node.job.error}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        ) : isReference && mediaName ? (
          <>
            {mediaFileId && (
              <div
                className="flashboard-node-drag-handle"
                title="Drag to timeline"
                draggable
                onDragStart={handleDragStart}
                onMouseDown={(e) => e.stopPropagation()}
              >
                +
              </div>
            )}
            <div className="flashboard-node-content">
              <div className="flashboard-node-prompt">{mediaName}</div>
            </div>
          </>
        ) : (
          <div className="flashboard-node-content">
            {mediaFileId && (
              <div
                className="flashboard-node-drag-handle"
                title="Drag to timeline"
                draggable
                onDragStart={handleDragStart}
                onMouseDown={(e) => e.stopPropagation()}
              >
                +
              </div>
            )}
            <div className={`flashboard-node-prompt ${!prompt ? 'empty' : ''}`}>
              {prompt || 'No prompt yet'}
            </div>
            {provider && (
              <div className="flashboard-node-provider">{provider}</div>
            )}
            {detailTokens.length > 0 && (
              <div className="flashboard-node-details">
                {detailTokens.map((token) => (
                  <span key={token} className="flashboard-node-detail-pill">{token}</span>
                ))}
              </div>
            )}
            {(isActive || status === 'completed') && (
              <div className="flashboard-node-meta">
                <span>{statusLabel}</span>
                {startedAt && <span>{elapsedLabel}</span>}
              </div>
            )}
          </div>
        )}
        {status === 'processing' && node.job?.progress != null && (
          <div className={`flashboard-node-progress ${hasPreview ? 'overlay' : ''}`}>
            <div
              className="flashboard-node-progress-bar"
              style={{ width: `${Math.round(node.job.progress * 100)}%` }}
            />
          </div>
        )}
        {status === 'failed' && node.job?.error && (
          <div className="flashboard-node-error" title={node.job.error}>
            {node.job.error}
          </div>
        )}
      </div>
    </div>
  );
}

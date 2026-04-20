import { useCallback } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectSelectedNodes } from '../../../stores/flashboardStore/selectors';
import { getFlashBoardPriceEstimate } from '../../../services/flashboard/FlashBoardPricing';
import { useMediaStore } from '../../../stores/mediaStore';

export function FlashBoardInspector() {
  const selectedNodes = useFlashBoardStore(selectSelectedNodes);
  const openComposer = useFlashBoardStore((s) => s.openComposer);
  const duplicateNode = useFlashBoardStore((s) => s.duplicateNode);
  const removeNode = useFlashBoardStore((s) => s.removeNode);
  const queueNode = useFlashBoardStore((s) => s.queueNode);
  const clearSelection = useFlashBoardStore((s) => s.clearSelection);
  const composerOpen = useFlashBoardStore((s) => s.composer.isOpen);

  const node = selectedNodes[0];
  const nodeId = node?.id;
  const request = node?.request;

  const status = node?.job?.status ?? 'draft';
  const priceEstimate = request
    ? getFlashBoardPriceEstimate({
      service: request.service,
      providerId: request.providerId,
      outputType: request.outputType,
      mode: request.mode,
      duration: request.duration,
      imageSize: request.imageSize,
      generateAudio: request.generateAudio,
      hasStartFrame: Boolean(request.startMediaFileId),
      multiShots: request.multiShots,
    })
    : null;
  const startReferenceName = useMediaStore((s) =>
    request?.startMediaFileId
      ? s.files.find((file) => file.id === request.startMediaFileId)?.name
      : undefined
  );
  const endReferenceName = useMediaStore((s) =>
    request?.endMediaFileId
      ? s.files.find((file) => file.id === request.endMediaFileId)?.name
      : undefined
  );
  const referenceFrameNames = useMediaStore((s) =>
    (request?.referenceMediaFileIds ?? [])
      .map((mediaFileId) => s.files.find((file) => file.id === mediaFileId)?.name)
      .filter((name): name is string => Boolean(name))
  );

  const handleEdit = useCallback(() => {
    if (!nodeId) return;
    openComposer(nodeId);
  }, [nodeId, openComposer]);

  const handleRetry = useCallback(() => {
    if (!nodeId) return;
    queueNode(nodeId);
  }, [nodeId, queueNode]);

  const handleDuplicate = useCallback(() => {
    if (!nodeId) return;
    duplicateNode(nodeId);
  }, [nodeId, duplicateNode]);

  const handleDelete = useCallback(() => {
    if (!nodeId) return;
    removeNode(nodeId);
    clearSelection();
  }, [nodeId, removeNode, clearSelection]);

  if (!node || composerOpen) return null;

  return (
    <div className="flashboard-inspector">
      <div className="flashboard-inspector-header">
        <span>Node Details</span>
      </div>

      <div className="flashboard-inspector-body">
        <div className="flashboard-inspector-section">
          <h4>Status</h4>
          <span className={`flashboard-inspector-status ${status}`}>
            {status}
          </span>
        </div>

        {node.request?.prompt && (
          <div className="flashboard-inspector-section">
            <h4>Prompt</h4>
            <p>{node.request.prompt}</p>
          </div>
        )}

        {node.request?.negativePrompt && (
          <div className="flashboard-inspector-section">
            <h4>Negative Prompt</h4>
            <p>{node.request.negativePrompt}</p>
          </div>
        )}

        {node.request?.providerId && (
          <div className="flashboard-inspector-section">
            <h4>Provider</h4>
            <p>{node.request.providerId} ({node.request.service}) v{node.request.version}</p>
          </div>
        )}

        {node.request && (
          <div className="flashboard-inspector-section">
            <h4>Settings</h4>
            <p>
              {node.request.duration && `${node.request.duration}s`}
              {node.request.aspectRatio && ` / ${node.request.aspectRatio}`}
              {node.request.mode && ` / ${node.request.mode}`}
              {node.request.generateAudio && ' / sound'}
              {node.request.multiShots && ' / multi-shot'}
            </p>
          </div>
        )}

        {node.request?.multiShots && (node.request.multiPrompt?.length ?? 0) > 0 && (
          <div className="flashboard-inspector-section">
            <h4>Shots</h4>
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {node.request.multiPrompt?.map((shot) => `${shot.index}. ${shot.duration}s - ${shot.prompt}`).join('\n')}
            </p>
          </div>
        )}

        {priceEstimate && (
          <div className="flashboard-inspector-section">
            <h4>Cost</h4>
            <p>{priceEstimate.fullLabel}</p>
          </div>
        )}

        {node.request?.outputType === 'image' && referenceFrameNames.length > 0 && (
          <div className="flashboard-inspector-section">
            <h4>Reference Frame</h4>
            <p>{referenceFrameNames.join(', ')}</p>
          </div>
        )}

        {node.request?.outputType !== 'image' && (startReferenceName || endReferenceName) && (
          <div className="flashboard-inspector-section">
            <h4>Reference Frames</h4>
            <p>
              {startReferenceName ? `Start: ${startReferenceName}` : 'Start: none'}
              <br />
              {endReferenceName ? `End: ${endReferenceName}` : 'End: none'}
            </p>
          </div>
        )}

        {status === 'processing' && node.job?.progress != null && (
          <div className="flashboard-inspector-section">
            <h4>Progress</h4>
            <p>{Math.round(node.job.progress * 100)}%</p>
          </div>
        )}

        {status === 'failed' && node.job?.error && (
          <div className="flashboard-inspector-section">
            <h4>Error</h4>
            <p style={{ color: '#ef5350' }}>{node.job.error}</p>
          </div>
        )}

        <div className="flashboard-inspector-actions">
          {(status === 'draft' || status === 'failed') && (
            <button className="flashboard-inspector-btn" onClick={handleEdit}>
              Edit
            </button>
          )}
          {status === 'failed' && (
            <button className="flashboard-inspector-btn" onClick={handleRetry}>
              Retry
            </button>
          )}
          {status === 'completed' && (
            <button className="flashboard-inspector-btn primary">
              Add to Timeline
            </button>
          )}
          <button className="flashboard-inspector-btn" onClick={handleDuplicate}>
            Duplicate
          </button>
          <button className="flashboard-inspector-btn danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

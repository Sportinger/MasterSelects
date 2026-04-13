import { useCallback } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectSelectedNodes } from '../../../stores/flashboardStore/selectors';

export function FlashBoardInspector() {
  const selectedNodes = useFlashBoardStore(selectSelectedNodes);
  const openComposer = useFlashBoardStore((s) => s.openComposer);
  const duplicateNode = useFlashBoardStore((s) => s.duplicateNode);
  const removeNode = useFlashBoardStore((s) => s.removeNode);
  const queueNode = useFlashBoardStore((s) => s.queueNode);
  const clearSelection = useFlashBoardStore((s) => s.clearSelection);
  const composerOpen = useFlashBoardStore((s) => s.composer.isOpen);

  const node = selectedNodes[0];
  if (!node || composerOpen) return null;

  const status = node.job?.status ?? 'draft';

  const handleEdit = useCallback(() => {
    openComposer(node.id);
  }, [node.id, openComposer]);

  const handleRetry = useCallback(() => {
    queueNode(node.id);
  }, [node.id, queueNode]);

  const handleDuplicate = useCallback(() => {
    duplicateNode(node.id);
  }, [node.id, duplicateNode]);

  const handleDelete = useCallback(() => {
    removeNode(node.id);
    clearSelection();
  }, [node.id, removeNode, clearSelection]);

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

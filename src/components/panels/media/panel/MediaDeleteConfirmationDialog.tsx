import type { Dispatch, SetStateAction } from 'react';
import {
  getMediaDeleteImpact,
  type MediaDeleteConfirmationRequest,
} from './useMediaPanelRenameDeleteCommands';

interface MediaDeleteConfirmationDialogProps {
  deleteConfirmation: MediaDeleteConfirmationRequest;
  deleteConfirmationBusy: boolean;
  setDeleteConfirmation: Dispatch<SetStateAction<MediaDeleteConfirmationRequest | null>>;
  confirmMediaDelete: () => Promise<void>;
}

export function MediaDeleteConfirmationDialog({
  deleteConfirmation,
  deleteConfirmationBusy,
  setDeleteConfirmation,
  confirmMediaDelete,
}: MediaDeleteConfirmationDialogProps) {
  const impact = getMediaDeleteImpact(deleteConfirmation.mediaFiles, deleteConfirmation.usages);
  const compositionNames = [...new Map(
    deleteConfirmation.usages.flatMap(usage =>
      usage.compositions.map(composition => [composition.compositionId, composition.compositionName] as const)
    )
  ).values()];

  return (
    <div
      className="media-delete-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleteConfirmationBusy) {
          setDeleteConfirmation(null);
        }
      }}
    >
      <div
        className="media-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-delete-dialog-title"
      >
        <div className="media-delete-dialog-kicker">Delete media</div>
        <h3 id="media-delete-dialog-title">Delete {impact.fileLabel}?</h3>
        {impact.clipCount > 0 && (
          <p>
            {impact.clipCount} clip{impact.clipCount === 1 ? '' : 's'} in {impact.compositionCount} composition{impact.compositionCount === 1 ? '' : 's'} will be removed from the timeline.
          </p>
        )}
        {compositionNames.length > 0 && (
          <div className="media-delete-dialog-comps">
            {compositionNames.slice(0, 4).join(', ')}
            {compositionNames.length > 4 ? `, +${compositionNames.length - 4} more` : ''}
          </div>
        )}
        <div className="media-delete-dialog-warning">
          This also deletes raw source files, proxies, analyses, transcripts, waveform caches, thumbnails, and related audio-analysis artifacts from the project folder.
        </div>
        <div className="media-delete-dialog-actions">
          <button
            type="button"
            className="media-delete-dialog-button secondary"
            disabled={deleteConfirmationBusy}
            onClick={() => setDeleteConfirmation(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="media-delete-dialog-button danger"
            disabled={deleteConfirmationBusy}
            onClick={confirmMediaDelete}
          >
            {deleteConfirmationBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

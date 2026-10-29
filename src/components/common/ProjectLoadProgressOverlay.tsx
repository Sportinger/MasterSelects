import { useMediaStore } from '../../stores/mediaStore';
import { continueProjectSwitchWithoutCopies } from '../../services/project/mediaCopy/projectSwitchCopyWait';
import { LiveInputReconnectPrompt } from './LiveInputReconnectPrompt';
import { PremiereSequenceImportDialog } from './PremiereSequenceImportDialog';

export function ProjectLoadProgressOverlay() {
  const progress = useMediaStore((state) => state.projectLoadProgress);

  const percent = Math.max(0, Math.min(100, progress.percent));
  const itemText = progress.itemsTotal && progress.itemsTotal > 0
    ? `${progress.itemsDone ?? 0}/${progress.itemsTotal}`
    : null;

  return (
    <>
      {progress.active && (
        <div className="project-load-progress" role="status" aria-live="polite">
          <div className="project-load-progress-head">
            <span>{progress.message}</span>
            <span>{Math.round(percent)}%</span>
          </div>
          <div className="project-load-progress-bar" aria-hidden="true">
            <div style={{ width: `${percent}%` }} />
          </div>
          {(progress.detail || itemText) && (
            <div className="project-load-progress-detail">
              <span>{progress.detail}</span>
              {itemText && <span>{itemText}</span>}
            </div>
          )}
          {progress.action === 'continue-without-copies' && (
            <div className="project-load-progress-action">
              <span>Media not copied yet must be picked again in this project.</span>
              <button
                type="button"
                data-testid="project-switch-continue-without-copies"
                onPointerUp={(event) => event.currentTarget.blur()}
                onClick={continueProjectSwitchWithoutCopies}
              >
                Continue without it
              </button>
            </div>
          )}
        </div>
      )}
      <LiveInputReconnectPrompt />
      <PremiereSequenceImportDialog />
    </>
  );
}

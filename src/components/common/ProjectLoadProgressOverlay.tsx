import { useMediaStore } from '../../stores/mediaStore';

export function ProjectLoadProgressOverlay() {
  const progress = useMediaStore((state) => state.projectLoadProgress);

  if (!progress.active) {
    return null;
  }

  const percent = Math.max(0, Math.min(100, progress.percent));
  const itemText = progress.itemsTotal && progress.itemsTotal > 0
    ? `${progress.itemsDone ?? 0}/${progress.itemsTotal}`
    : null;

  return (
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
    </div>
  );
}

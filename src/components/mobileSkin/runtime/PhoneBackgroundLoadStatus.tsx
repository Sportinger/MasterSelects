// Phone replacement for the desktop project-load toast. Blocking loads are covered by the opaque
// PhoneProjectLoadingView, and the 'ready' flash adds nothing; what is left are background steps
// (thumbnails, metadata, caches) and a failed load, shown as an opaque phone card. A failure stays
// until dismissed, so it is never lost silently.
import { useMediaStore } from '../../../stores/mediaStore';
import { setProjectLoadProgress } from '../../../services/projectSync';
import './PhoneProjectLoading.css';

export function PhoneBackgroundLoadStatus() {
  const progress = useMediaStore((state) => state.projectLoadProgress);
  if (!progress.active || progress.blocking || progress.phase === 'ready' || progress.phase === 'idle') return null;
  const failed = progress.phase === 'error';
  const percent = Math.max(0, Math.min(100, progress.percent));
  return (
    <div
      className={failed ? 'phone-load-status is-error' : 'phone-load-status'}
      data-testid="phone-load-status"
      data-phase={progress.phase}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <div className="phone-load-status__head">
        <span className="phone-load-status__message">{progress.message}</span>
        {failed ? (
          <button type="button" className="phone-load-status__dismiss" onClick={() => setProjectLoadProgress(null)}>Dismiss</button>
        ) : <span>{Math.round(percent)}%</span>}
      </div>
      {progress.detail ? <p className="phone-load-status__detail">{progress.detail}</p> : null}
    </div>
  );
}

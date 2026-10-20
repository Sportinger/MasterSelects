import { useEffect, useState } from 'react';
import { subscribeEditRejections, type EditRejection } from '../../services/editRejection';
import './HistoryActionToast.css';

const EDIT_REJECTED_TOAST_DURATION_MS = 4000;

/** Explains why an edit did nothing while this tab may not write the project. */
export function EditRejectedToast() {
  const [rejection, setRejection] = useState<EditRejection | null>(null);

  useEffect(() => subscribeEditRejections(next => {
    // A drag can be rejected on every pointer move; keep one notice per message.
    setRejection(current => current?.message === next.message ? current : next);
  }), []);

  useEffect(() => {
    if (!rejection) return;
    const timer = window.setTimeout(() => setRejection(null), EDIT_REJECTED_TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [rejection]);

  if (!rejection) return null;

  return (
    <div key={rejection.at} className="history-action-toast history-action-toast--notice" role="status" aria-live="polite">
      <span className="history-action-toast-operation">Not applied</span>
      <span className="history-action-toast-label">{rejection.message}</span>
    </div>
  );
}

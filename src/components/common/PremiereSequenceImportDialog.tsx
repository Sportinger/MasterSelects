import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  getPremiereSequenceSelectionSnapshot,
  resolvePremiereSequenceSelection,
  subscribePremiereSequenceSelection,
} from '../../importers/premiere/premiereSequenceSelectionRuntime';
import './PremiereSequenceImportDialog.css';

export function PremiereSequenceImportDialog() {
  const request = useSyncExternalStore(
    subscribePremiereSequenceSelection,
    getPremiereSequenceSelectionSnapshot,
    () => null,
  );
  return request ? <PremiereSequenceImportDialogContent key={request.id} request={request} /> : null;
}

type PremiereSequenceSelectionRequest = NonNullable<
  ReturnType<typeof getPremiereSequenceSelectionSnapshot>
>;

function PremiereSequenceImportDialogContent({
  request,
}: {
  request: PremiereSequenceSelectionRequest;
}) {
  const [selectedUids, setSelectedUids] = useState<Set<string>>(() => (
    new Set(request.summary.sequences.map((sequence) => sequence.uid))
  ));

  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resolvePremiereSequenceSelection(request.id, null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [request]);

  const selectedClipCount = useMemo(() => request.summary.sequences.reduce(
    (total, sequence) => total + (selectedUids.has(sequence.uid) ? sequence.clipCount : 0),
    0,
  ), [request, selectedUids]);

  const sequences = request.summary.sequences;
  const allSelected = selectedUids.size === sequences.length;

  return (
    <div className="premiere-sequence-dialog-backdrop">
      <section
        className="premiere-sequence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="premiere-sequence-dialog-title"
      >
        <header>
          <div>
            <h2 id="premiere-sequence-dialog-title">Choose Premiere sequences</h2>
            <p>{request.fileName}</p>
          </div>
          <button
            type="button"
            className="premiere-sequence-dialog-close"
            aria-label="Cancel Premiere project import"
            onClick={() => resolvePremiereSequenceSelection(request.id, null)}
          >
            ×
          </button>
        </header>

        <div className="premiere-sequence-dialog-toolbar">
          <span>{sequences.length} sequences · {request.summary.mediaCount} media references</span>
          <button
            type="button"
            onClick={() => setSelectedUids(allSelected ? new Set() : new Set(sequences.map((sequence) => sequence.uid)))}
          >
            {allSelected ? 'Select none' : 'Select all'}
          </button>
        </div>

        <div className="premiere-sequence-dialog-list">
          {sequences.map((sequence) => (
            <label key={sequence.uid} className="premiere-sequence-dialog-row">
              <input
                type="checkbox"
                checked={selectedUids.has(sequence.uid)}
                onChange={(event) => {
                  setSelectedUids((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(sequence.uid);
                    else next.delete(sequence.uid);
                    return next;
                  });
                }}
              />
              <span className="premiere-sequence-dialog-name">{sequence.name}</span>
              <span className="premiere-sequence-dialog-meta">
                {sequence.videoTrackCount}V · {sequence.audioTrackCount}A · {sequence.clipCount} clips
              </span>
            </label>
          ))}
        </div>

        <footer>
          <span>{selectedUids.size} selected · {selectedClipCount} clips</span>
          <div>
            <button type="button" onClick={() => resolvePremiereSequenceSelection(request.id, null)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={selectedUids.size === 0}
              onClick={() => resolvePremiereSequenceSelection(request.id, [...selectedUids])}
            >
              Import selected
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

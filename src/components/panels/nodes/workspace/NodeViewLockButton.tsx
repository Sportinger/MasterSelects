/** Locked keeps the shown graph (default: the whole timeline); unlocked follows the selection. */
export function NodeViewLockButton({ locked, onChange }: { locked: boolean; onChange: (locked: boolean) => void }) {
  const label = locked ? 'View locked: selection does not change the graph' : 'View follows the selection';
  return <button type="button" className="node-workspace-toolbar-button node-view-lock" aria-pressed={locked}
    aria-label={locked ? 'Unlock node view' : 'Lock node view'} title={label}
    onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onChange(!locked); }}>
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d={locked ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7V5a2.5 2.5 0 0 1 4.9-.7'} />
    </svg>
  </button>;
}

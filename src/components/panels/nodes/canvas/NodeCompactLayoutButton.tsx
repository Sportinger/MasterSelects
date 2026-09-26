export function NodeCompactLayoutButton({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return <button type="button" className="node-workspace-toolbar-button" aria-pressed={enabled}
    title="Wrap top-level effects into compact rows; keep their internal layout unchanged" onClick={event => {
      onToggle(); if (event.detail > 0) event.currentTarget.blur();
    }}>Compact</button>;
}

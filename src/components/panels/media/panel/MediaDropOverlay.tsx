export function MediaDropOverlay() {
  return (
    <div className="media-panel-drop-overlay">
      <div className="drop-overlay-content">
        <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>Drop files or folders to import</span>
      </div>
    </div>
  );
}

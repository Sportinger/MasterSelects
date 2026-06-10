interface ExportUnsupportedStateProps {
  onClose: () => void;
}

export function ExportUnsupportedState({ onClose }: ExportUnsupportedStateProps) {
  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Export Video</h2>
        <div className="export-error">
          WebCodecs is not supported in this browser.
          Please use Chrome 94+ or Safari 16.4+.
        </div>
        <div className="export-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

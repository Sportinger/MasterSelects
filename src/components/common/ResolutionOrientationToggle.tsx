import { useState } from 'react';
import './ResolutionOrientationToggle.css';

interface ResolutionOrientationToggleProps {
  disabled?: boolean;
  width: number;
  height: number;
  onToggle: () => void;
}

/** Shared landscape/portrait switch used by composition and export settings. */
export function ResolutionOrientationToggle({
  disabled = false,
  width,
  height,
  onToggle,
}: ResolutionOrientationToggleProps) {
  const [previewLocked, setPreviewLocked] = useState(false);
  const isPortrait = height > width;

  return (
    <button
      type="button"
      className={`resolution-orientation-toggle${previewLocked ? ' is-preview-locked' : ''}`}
      disabled={disabled}
      onClick={() => {
        onToggle();
        setPreviewLocked(true);
      }}
      onMouseLeave={() => setPreviewLocked(false)}
      onBlur={() => setPreviewLocked(false)}
      aria-label={`Switch to ${isPortrait ? '16:9 landscape' : '9:16 portrait'}`}
      title={`Switch to ${isPortrait ? '16:9 landscape' : '9:16 portrait'}`}
    >
      <span className={`resolution-orientation-icon${isPortrait ? ' is-portrait' : ''}`} aria-hidden="true" />
      <svg className="resolution-orientation-preview" viewBox="0 0 24 24" aria-hidden="true">
        <path className="resolution-orientation-preview-arc" d="M4 18A14 14 0 0 1 18 4" />
        <path className="resolution-orientation-preview-head" d="M13 4h5v5" />
      </svg>
    </button>
  );
}

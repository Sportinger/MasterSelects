// Preview bottom-left controls: transparency grid toggle + quality selector

import React from 'react';
import type { PreviewQuality } from '../../stores/settingsStore';

interface PreviewBottomControlsProps {
  showTransparencyGrid: boolean;
  compositionId: string | null;
  panelId: string;
  updatePanelData: (panelId: string, data: Record<string, unknown>) => void;
  previewQuality: PreviewQuality;
  setPreviewQuality: (q: PreviewQuality) => void;
  qualityOpen: boolean;
  setQualityOpen: (v: boolean) => void;
  qualityDropdownRef: React.RefObject<HTMLDivElement | null>;
}

export function PreviewBottomControls({
  showTransparencyGrid,
  compositionId,
  panelId,
  updatePanelData,
  previewQuality,
  setPreviewQuality,
  qualityOpen,
  setQualityOpen,
  qualityDropdownRef,
}: PreviewBottomControlsProps) {
  return (
    <div className="preview-controls-bottom">
      <button
        className={`preview-transparency-toggle ${showTransparencyGrid ? 'active' : ''}`}
        onClick={() => updatePanelData(panelId, { compositionId, showTransparencyGrid: !showTransparencyGrid })}
        title="Toggle transparency grid (checkerboard)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="0" y="0" width="4" height="4" opacity="0.6" />
          <rect x="8" y="0" width="4" height="4" opacity="0.6" />
          <rect x="4" y="4" width="4" height="4" opacity="0.6" />
          <rect x="12" y="4" width="4" height="4" opacity="0.6" />
          <rect x="0" y="8" width="4" height="4" opacity="0.6" />
          <rect x="8" y="8" width="4" height="4" opacity="0.6" />
          <rect x="4" y="12" width="4" height="4" opacity="0.6" />
          <rect x="12" y="12" width="4" height="4" opacity="0.6" />
        </svg>
      </button>

      <div className="preview-quality-dropdown-wrapper" ref={qualityDropdownRef}>
        <button
          className="preview-quality-dropdown-btn"
          onClick={() => setQualityOpen(!qualityOpen)}
          title="Preview quality (affects performance)"
        >
          <span className="preview-quality-label">
            {previewQuality === 1 ? 'Full' : previewQuality === 0.5 ? 'Half' : 'Quarter'}
          </span>
          <span className="preview-comp-arrow">▼</span>
        </button>
        {qualityOpen && (
          <div className="preview-quality-dropdown">
            {([
              { value: 1 as PreviewQuality, label: 'Full', desc: '100%' },
              { value: 0.5 as PreviewQuality, label: 'Half', desc: '50%' },
              { value: 0.25 as PreviewQuality, label: 'Quarter', desc: '25%' },
            ]).map(({ value, label, desc }) => (
              <button
                key={value}
                className={`preview-quality-option ${previewQuality === value ? 'active' : ''}`}
                onClick={() => {
                  setPreviewQuality(value);
                  setQualityOpen(false);
                }}
              >
                {label} <span className="preview-quality-desc">{desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

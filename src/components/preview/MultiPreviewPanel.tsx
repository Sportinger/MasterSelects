// Multi Preview Panel — 2x2 grid of independent preview slots
// Shared controls: source dropdown, transparency toggle, quality selector, stats overlay
// Source modes: "Custom" (per-slot composition) or a composition (auto-distributes first 4 video layers)

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useEngineStore } from '../../stores/engineStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore, type PreviewQuality } from '../../stores/settingsStore';
import { useDockStore } from '../../stores/dockStore';
import { StatsOverlay } from './StatsOverlay';
import { MultiPreviewSlot } from './MultiPreviewSlot';
import type { MultiPreviewPanelData } from '../../types/dock';
import './MultiPreview.css';

interface MultiPreviewPanelProps {
  panelId: string;
  data: MultiPreviewPanelData;
}

export function MultiPreviewPanel({ panelId, data }: MultiPreviewPanelProps) {
  const { engineStats } = useEngineStore();
  const compositions = useMediaStore((s) => s.compositions);
  const { previewQuality, setPreviewQuality } = useSettingsStore();
  const updatePanelData = useDockStore((s) => s.updatePanelData);
  const outputResolution = useSettingsStore((s) => s.outputResolution);

  const [statsExpanded, setStatsExpanded] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  const [highlightedSlot, setHighlightedSlot] = useState<number | null>(null);

  const isAutoMode = data.sourceCompositionId !== null;
  const sourceComp = useMemo(
    () => compositions.find((c) => c.id === data.sourceCompositionId),
    [compositions, data.sourceCompositionId]
  );

  // Highlight slots on 1/2/3/4 key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx <= 3) setHighlightedSlot(idx);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx <= 3) setHighlightedSlot((prev) => (prev === idx ? null : prev));
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!sourceOpen && !qualityOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sourceOpen && sourceDropdownRef.current && !sourceDropdownRef.current.contains(target)) {
        setSourceOpen(false);
      }
      if (qualityOpen) {
        setQualityOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sourceOpen, qualityOpen]);

  const handleSourceChange = useCallback(
    (compositionId: string | null) => {
      updatePanelData(panelId, { ...data, sourceCompositionId: compositionId });
      setSourceOpen(false);
    },
    [panelId, data, updatePanelData]
  );

  const handleSlotCompositionChange = useCallback(
    (slotIndex: number, compositionId: string | null) => {
      const newSlots = [...data.slots] as MultiPreviewPanelData['slots'];
      newSlots[slotIndex] = { compositionId };
      updatePanelData(panelId, { ...data, slots: newSlots });
    },
    [panelId, data, updatePanelData]
  );

  const toggleTransparency = useCallback(() => {
    updatePanelData(panelId, { ...data, showTransparencyGrid: !data.showTransparencyGrid });
  }, [panelId, data, updatePanelData]);

  return (
    <div className="multi-preview-container">
      {/* Shared controls bar */}
      <div className="preview-controls multi-preview-controls">
        {/* Source composition dropdown */}
        <div className="preview-comp-dropdown-wrapper" ref={sourceDropdownRef}>
          <button
            className="preview-comp-dropdown-btn"
            onClick={() => setSourceOpen(!sourceOpen)}
            title="Select source: Custom (per-slot) or a composition (auto-distribute layers)"
          >
            <span className="preview-comp-name">
              {isAutoMode ? sourceComp?.name || 'Unknown' : 'Custom'}
            </span>
            <span className="preview-comp-arrow">▼</span>
          </button>
          {sourceOpen && (
            <div className="preview-comp-dropdown">
              <button
                className={`preview-comp-option ${!isAutoMode ? 'active' : ''}`}
                onClick={() => handleSourceChange(null)}
              >
                Custom
              </button>
              <div className="preview-comp-separator" />
              {compositions.map((comp) => (
                <button
                  key={comp.id}
                  className={`preview-comp-option ${data.sourceCompositionId === comp.id ? 'active' : ''}`}
                  onClick={() => handleSourceChange(comp.id)}
                >
                  {comp.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transparency toggle */}
        <button
          className={`preview-transparency-toggle ${data.showTransparencyGrid ? 'active' : ''}`}
          onClick={toggleTransparency}
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

        {/* Quality dropdown */}
        <div className="preview-quality-dropdown-wrapper">
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

      {/* 2x2 grid — wrapper centers the 16:9 block, grid scales uniformly */}
      <div className="multi-preview-grid-wrapper">
        <div className="multi-preview-grid">
          {data.slots.map((slot, index) => (
            <MultiPreviewSlot
              key={index}
              panelId={panelId}
              slotIndex={index}
              compositionId={slot.compositionId}
              showTransparencyGrid={data.showTransparencyGrid}
              onCompositionChange={(compId) => handleSlotCompositionChange(index, compId)}
              highlighted={highlightedSlot === index}
              autoSource={
                isAutoMode && data.sourceCompositionId
                  ? { compositionId: data.sourceCompositionId, layerIndex: index }
                  : null
              }
            />
          ))}
        </div>
      </div>

      {/* Single stats overlay over the whole panel */}
      <StatsOverlay
        stats={engineStats}
        resolution={outputResolution}
        expanded={statsExpanded}
        onToggle={() => setStatsExpanded(!statsExpanded)}
      />
    </div>
  );
}

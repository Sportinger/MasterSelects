// SourceSelector - dropdown to select what a render target shows

import { useState, useRef, useEffect } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import type { RenderSource } from '../../types/renderTarget';

interface SourceSelectorProps {
  currentSource: RenderSource;
  onChange: (source: RenderSource) => void;
}

function sourceLabel(source: RenderSource, compositions: { id: string; name: string }[]): string {
  switch (source.type) {
    case 'activeComp':
      return 'Active Composition';
    case 'program':
      return 'Program (Main Mix)';
    case 'composition': {
      const comp = compositions.find(c => c.id === source.compositionId);
      return comp?.name ?? 'Unknown Composition';
    }
    case 'slot':
      return `Slot ${source.slotIndex + 1}`;
    case 'layer':
      return `Layer (${source.layerIds.length})`;
    default:
      return 'Unknown';
  }
}

export function SourceSelector({ currentSource, onChange }: SourceSelectorProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const compositions = useMediaStore((s) => s.compositions);
  const activeLayerSlots = useMediaStore((s) => s.activeLayerSlots);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const label = sourceLabel(currentSource, compositions);

  // Build slot entries from activeLayerSlots
  const slotEntries: { index: number; compName: string | null }[] = [];
  if (activeLayerSlots) {
    for (const [key, compId] of Object.entries(activeLayerSlots)) {
      const idx = Number(key);
      const comp = compId ? compositions.find(c => c.id === compId) : null;
      slotEntries.push({ index: idx, compName: comp?.name ?? null });
    }
    slotEntries.sort((a, b) => a.index - b.index);
  }

  return (
    <div className="om-source-selector" ref={dropdownRef}>
      <button
        className="om-source-btn"
        onClick={() => setOpen(!open)}
        title="Select source"
      >
        <span className="om-source-label">{label}</span>
        <span className="om-source-arrow">▼</span>
      </button>
      {open && (
        <div className="om-source-dropdown">
          <button
            className={`om-source-option ${currentSource.type === 'activeComp' ? 'active' : ''}`}
            onClick={() => { onChange({ type: 'activeComp' }); setOpen(false); }}
          >
            Active Composition
          </button>
          <div className="om-source-separator" />
          {compositions.map((comp) => (
            <button
              key={comp.id}
              className={`om-source-option ${currentSource.type === 'composition' && currentSource.compositionId === comp.id ? 'active' : ''}`}
              onClick={() => { onChange({ type: 'composition', compositionId: comp.id }); setOpen(false); }}
            >
              {comp.name}
            </button>
          ))}
          {slotEntries.length > 0 && (
            <>
              <div className="om-source-separator" />
              {slotEntries.map((slot) => (
                <button
                  key={`slot-${slot.index}`}
                  className={`om-source-option ${currentSource.type === 'slot' && currentSource.slotIndex === slot.index ? 'active' : ''}`}
                  onClick={() => { onChange({ type: 'slot', slotIndex: slot.index }); setOpen(false); }}
                >
                  Slot {slot.index + 1}{slot.compName ? ` (${slot.compName})` : ' (Empty)'}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

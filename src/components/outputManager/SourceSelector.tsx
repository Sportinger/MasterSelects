// SourceSelector - dropdown to select what a render target shows

import { useState, useRef, useEffect } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { isUserVisibleComposition } from '../../stores/mediaStore/compositionVisibility';
import type { RenderSource } from '../../types/renderTarget';
import { listOutputSourceOptions, outputSourceKey, outputSourceLabel } from './outputSourceOptions';

interface SourceSelectorProps {
  currentSource: RenderSource;
  onChange: (source: RenderSource) => void;
}

export function SourceSelector({ currentSource, onChange }: SourceSelectorProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const allCompositions = useMediaStore((s) => s.compositions);
  const compositions = allCompositions.filter(isUserVisibleComposition);
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

  const label = outputSourceLabel(currentSource, compositions);
  const options = listOutputSourceOptions(compositions, allCompositions, activeLayerSlots);
  const currentKey = outputSourceKey(currentSource);
  const compositionOptions = options.filter((option) => option.group === 'composition');
  const slotOptions = options.filter((option) => option.group === 'slot');

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
          {compositionOptions.map((option) => (
            <button
              key={option.key}
              className={`om-source-option ${currentKey === option.key ? 'active' : ''}`}
              onClick={() => { onChange(option.source); setOpen(false); }}
            >
              {option.label}
            </button>
          ))}
          {slotOptions.length > 0 && (
            <>
              <div className="om-source-separator" />
              {slotOptions.map((option) => (
                <button
                  key={option.key}
                  className={`om-source-option ${currentKey === option.key ? 'active' : ''}`}
                  onClick={() => { onChange(option.source); setOpen(false); }}
                >
                  {option.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

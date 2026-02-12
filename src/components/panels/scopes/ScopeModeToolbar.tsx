import { useState, useRef, useEffect } from 'react';
import { useSettingsStore, type ScopeQuality } from '../../../stores/settingsStore';
import type { ScopeViewMode } from './useScopeAnalysis';
import './ScopesPanel.css';

interface ScopeModeToolbarProps {
  mode?: ScopeViewMode;
  onModeChange?: (mode: ScopeViewMode) => void;
}

const MODES: { id: ScopeViewMode; label: string; className: string }[] = [
  { id: 'rgb', label: 'RGB', className: 'scope-mode-rgb' },
  { id: 'r', label: 'R', className: 'scope-mode-r' },
  { id: 'g', label: 'G', className: 'scope-mode-g' },
  { id: 'b', label: 'B', className: 'scope-mode-b' },
  { id: 'luma', label: 'Y', className: 'scope-mode-luma' },
];

const QUALITY_OPTIONS: { value: ScopeQuality; label: string; desc: string }[] = [
  { value: 'low', label: 'Low', desc: '512p' },
  { value: 'medium', label: 'Medium', desc: '768p' },
  { value: 'high', label: 'High', desc: '1024p' },
];

export function ScopeQualityDropdown() {
  const scopeQuality = useSettingsStore((s) => s.scopeQuality);
  const setScopeQuality = useSettingsStore((s) => s.setScopeQuality);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const currentLabel = QUALITY_OPTIONS.find((o) => o.value === scopeQuality)?.label ?? 'Low';

  return (
    <div className="scope-quality-dropdown-wrapper" ref={wrapperRef}>
      <button className="scope-quality-dropdown-btn" onClick={() => setOpen(!open)} title="Scope quality">
        <span className="scope-quality-label">{currentLabel}</span>
        <span className="scope-quality-arrow">&#9660;</span>
      </button>
      {open && (
        <div className="scope-quality-dropdown">
          {QUALITY_OPTIONS.map(({ value, label, desc }) => (
            <button
              key={value}
              className={`scope-quality-option ${scopeQuality === value ? 'active' : ''}`}
              onClick={() => { setScopeQuality(value); setOpen(false); }}
            >
              {label} <span className="scope-quality-desc">{desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScopeModeToolbar({ mode, onModeChange }: ScopeModeToolbarProps) {
  return (
    <div className="scope-mode-toolbar">
      {mode != null && onModeChange && MODES.map((m) => (
        <button
          key={m.id}
          className={`scope-mode-btn ${m.className} ${mode === m.id ? 'active' : ''}`}
          onClick={() => onModeChange(m.id)}
          title={m.id === 'luma' ? 'Luma (BT.709)' : m.label}
        >
          {m.label}
        </button>
      ))}
      <div className="scope-toolbar-spacer" />
      <ScopeQualityDropdown />
    </div>
  );
}

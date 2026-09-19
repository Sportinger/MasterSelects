import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { ScopeDisplayMode } from '../../../types/dock';
import { HistogramScope } from './HistogramScope';
import { ScopeModeToolbar } from './ScopeModeToolbar';
import type { ScopeViewMode } from './useScopeAnalysis';
import { VectorscopeScope } from './VectorscopeScope';
import { WaveformScope } from './WaveformScope';
import './ScopesPanel.css';

interface ScopesPanelProps {
  initialMode?: ScopeDisplayMode;
}

const SCOPE_MODES: readonly { id: ScopeDisplayMode; label: string }[] = [
  { id: 'parade', label: 'Parade' },
  { id: 'waveform', label: 'Waveform' },
  { id: 'vectorscope', label: 'Vectorscope' },
  { id: 'histogram', label: 'Histogram' },
];

const SCOPE_LABELS = Object.fromEntries(
  SCOPE_MODES.map(scopeMode => [scopeMode.id, scopeMode.label]),
) as Record<ScopeDisplayMode, string>;

const PARADE_SCALE = [1023, 896, 768, 640, 512, 384, 256, 128, 0];

export function ScopesPanel({ initialMode = 'parade' }: ScopesPanelProps) {
  const [mode, setMode] = useState<ScopeDisplayMode>(initialMode);
  const [viewMode, setViewMode] = useState<ScopeViewMode>('rgb');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsMenuOpen(false);
      triggerRef.current?.focus();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMenuOpen]);

  const openMenu = () => {
    setIsMenuOpen(true);
    requestAnimationFrame(() => {
      const selectedIndex = SCOPE_MODES.findIndex(scopeMode => scopeMode.id === mode);
      optionRefs.current[selectedIndex]?.focus();
    });
  };

  const selectMode = (nextMode: ScopeDisplayMode) => {
    setMode(nextMode);
    setIsMenuOpen(false);
    triggerRef.current?.focus();
  };

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = optionIndex;
    if (event.key === 'ArrowDown') nextIndex = (optionIndex + 1) % SCOPE_MODES.length;
    if (event.key === 'ArrowUp') nextIndex = (optionIndex - 1 + SCOPE_MODES.length) % SCOPE_MODES.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = SCOPE_MODES.length - 1;
    optionRefs.current[nextIndex]?.focus();
  };

  const supportsChannelModes = mode === 'waveform' || mode === 'histogram';

  return (
    <section className="scopes-panel">
      <header className="scopes-panel-header">
        <strong>Scopes</strong>
        {supportsChannelModes && (
          <ScopeModeToolbar mode={viewMode} onModeChange={setViewMode} />
        )}
        <div className="scope-type-selector" ref={selectorRef}>
          <button
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            aria-label="Scope type"
            className="scope-type-selector-trigger"
            onClick={() => (isMenuOpen ? setIsMenuOpen(false) : openMenu())}
            onKeyDown={event => {
              if (!isMenuOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                openMenu();
              }
            }}
            ref={triggerRef}
            type="button"
          >
            <span>{SCOPE_LABELS[mode]}</span>
            <svg aria-hidden="true" viewBox="0 0 10 6">
              <path d="M1 1l4 4 4-4" />
            </svg>
          </button>
          {isMenuOpen && (
            <div aria-label="Scope type" className="scope-type-selector-menu" role="menu">
              {SCOPE_MODES.map((scopeMode, index) => (
                <button
                  aria-checked={mode === scopeMode.id}
                  className={mode === scopeMode.id ? 'active' : undefined}
                  key={scopeMode.id}
                  onClick={() => selectMode(scopeMode.id)}
                  onKeyDown={event => handleOptionKeyDown(event, index)}
                  ref={element => { optionRefs.current[index] = element; }}
                  role="menuitemradio"
                  type="button"
                >
                  {scopeMode.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className={`scopes-panel-content scopes-panel-${mode}`}>
        {mode === 'parade' && (
          <div className="scope-rgb-parade" aria-label="RGB parade">
            <div aria-hidden="true" className="scope-reference-grid scope-parade-grid">
              {PARADE_SCALE.map(value => (
                <div className="scope-reference-grid-row" key={value}>
                  <span>{value}</span>
                  <i />
                </div>
              ))}
            </div>
            <div className="scope-rgb-parade-plots">
              <div className="scope-parade-combined">
                <WaveformScope
                  refreshIntervalMs={100}
                  showLegend={false}
                  sizing="fill"
                  viewMode="parade"
                />
              </div>
            </div>
          </div>
        )}
        {mode === 'waveform' && <WaveformScope sizing="fill" viewMode={viewMode} />}
        {mode === 'vectorscope' && <VectorscopeScope />}
        {mode === 'histogram' && <HistogramScope viewMode={viewMode} />}
      </div>
    </section>
  );
}

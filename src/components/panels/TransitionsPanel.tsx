// Transitions Panel - Drag and drop transitions for timeline clips

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent } from 'react';
import {
  getAllTransitions,
  getDefaultTransitionParams,
  getTransitionCapability,
  type TransitionCapability,
  type TransitionDefinition,
  type TransitionFamilyDimension,
} from '../../transitions';
import {
  serializeTransitionDropData,
  setActiveTransitionDragData,
  TRANSITION_MIME_TYPE,
} from '../timeline/transitionDragData';
import { TransitionPreview } from './transitions/TransitionPreview';
import {
  filterTransitionPanelItems,
  groupTransitionPanelItems,
  sectionTransitionPanelItems,
} from './transitions/transitionPanelItems';
import './TransitionsPanel.css';

interface TransitionItemProps {
  label: string;
  transition: TransitionDefinition;
  duration: number;
  capability: TransitionCapability;
  showCapabilityBadge: boolean;
  variantCount?: number;
  variant?: boolean;
  onClick?: () => void;
}

function TransitionItem({
  label,
  transition,
  duration,
  capability,
  showCapabilityBadge,
  variantCount,
  variant = false,
  onClick,
}: TransitionItemProps) {
  const dragStartedRef = useRef(false);
  const isPlanned = capability === 'planned';
  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (isPlanned) {
      e.preventDefault();
      return;
    }
    dragStartedRef.current = true;
    const dragData = {
      type: transition.id,
      duration,
      params: getDefaultTransitionParams(transition),
    };
    setActiveTransitionDragData(dragData);
    e.dataTransfer.setData(TRANSITION_MIME_TYPE, serializeTransitionDropData(dragData));
    e.dataTransfer.effectAllowed = 'copy';

    // Create drag image from the same thumbnail the panel shows.
    const dragEl = document.createElement('div');
    dragEl.className = 'transition-drag-preview';
    dragEl.style.cssText = [
      'position:fixed',
      'top:-120px',
      'left:-120px',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'width:150px',
      'padding:7px 9px',
      'border:1px solid rgba(148,163,184,0.45)',
      'border-radius:6px',
      'background:rgba(17,24,39,0.96)',
      'box-shadow:0 10px 28px rgba(0,0,0,0.35)',
      'color:white',
      'font-size:11px',
      'font-weight:600',
      'pointer-events:none',
    ].join(';');

    const previewClone = (e.currentTarget as HTMLElement)
      .querySelector('.transition-item-preview')
      ?.cloneNode(true);
    if (previewClone instanceof HTMLElement) {
      previewClone.style.width = '64px';
      previewClone.style.height = '32px';
      previewClone.style.flex = '0 0 auto';
      dragEl.appendChild(previewClone);
    }

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    dragEl.appendChild(labelEl);

    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 42, 20);
    setTimeout(() => dragEl.remove(), 0);
  }, [isPlanned, label, transition, duration]);

  const handleDragEnd = useCallback(() => {
    setActiveTransitionDragData(null);
    setTimeout(() => {
      dragStartedRef.current = false;
    }, 0);
  }, []);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!onClick || dragStartedRef.current) return;
    event.preventDefault();
    onClick();
  }, [onClick]);

  return (
    <div
      draggable={!isPlanned}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      className={[
        'transition-item',
        variant ? 'transition-item-variant' : '',
        isPlanned ? 'transition-item-planned' : '',
      ].filter(Boolean).join(' ')}
      title={transition.description}
      aria-disabled={isPlanned || undefined}
    >
      <div className="transition-item-preview">
        <TransitionPreview type={transition.id} />
      </div>
      <span className="transition-item-name">{label}</span>
      {variantCount !== undefined ? (
        <span className="transition-item-type-count" title={`${variantCount} transition types`}>
          {variantCount}
        </span>
      ) : null}
      {showCapabilityBadge ? (
        <span className={`transition-capability-badge transition-capability-${capability}`}>
          {capability}
        </span>
      ) : null}
    </div>
  );
}

export function TransitionsPanel() {
  const [duration, setDuration] = useState(2);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFamilyKey, setExpandedFamilyKey] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<TransitionFamilyDimension>>(() => new Set());
  const showCapabilityBadge = import.meta.env.DEV;
  const allTransitions = getAllTransitions({
    runtimeOnly: !showCapabilityBadge,
    includeExperimental: showCapabilityBadge,
    includePlanned: showCapabilityBadge,
  });
  const transitionItems = useMemo(() => groupTransitionPanelItems(allTransitions), [allTransitions]);
  const visibleTransitionItems = useMemo(
    () => filterTransitionPanelItems(transitionItems, searchQuery),
    [searchQuery, transitionItems]
  );
  const transitionSections = useMemo(() => sectionTransitionPanelItems(visibleTransitionItems), [visibleTransitionItems]);
  const isSearchActive = searchQuery.trim().length > 0;

  const handleDurationChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!Number.isNaN(value) && value > 0) {
      setDuration(Math.max(value, 0.1));
    }
  }, []);

  const toggleSection = useCallback((dimension: TransitionFamilyDimension) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(dimension)) {
        next.delete(dimension);
      } else {
        next.add(dimension);
      }
      return next;
    });
  }, []);

  const toggleFamily = useCallback((key: string) => {
    setExpandedFamilyKey((current) => current === key ? null : key);
  }, []);

  return (
    <div className="transitions-panel" onMouseLeave={() => setExpandedFamilyKey(null)}>
      <div className="transitions-panel-header">
        <span className="transitions-panel-title">Transitions</span>
        <div className="transitions-duration-control">
          <input
            type="number"
            value={duration}
            onChange={handleDurationChange}
            min={0.1}
            step={0.1}
            className="transitions-duration-input"
          />
          <span className="transitions-duration-unit">s</span>
        </div>
      </div>

      <div className="transitions-search">
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.4" />
          <path d="M10.3 10.3 14 14" />
        </svg>
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSearchQuery('');
          }}
          placeholder="Search transitions"
          aria-label="Search transitions"
        />
        {searchQuery ? (
          <button
            type="button"
            className="transitions-search-clear"
            onClick={() => setSearchQuery('')}
            title="Clear search"
            aria-label="Clear search"
          >
            x
          </button>
        ) : null}
      </div>

      <div className="transitions-list">
        {transitionSections.map((section) => {
          const isCollapsed = !isSearchActive && collapsedSections.has(section.dimension);
          return (
            <section className="transitions-family-section" key={section.dimension}>
              <button
                type="button"
                className="transitions-family-title-button"
                onClick={() => toggleSection(section.dimension)}
                aria-expanded={!isCollapsed}
              >
                <svg
                  className={isCollapsed ? 'transitions-family-chevron collapsed' : 'transitions-family-chevron'}
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M4 6 8 10 12 6" />
                </svg>
                <span className="transitions-family-title">{section.label}</span>
                <span className="transitions-family-count">{section.items.length}</span>
              </button>
              {!isCollapsed && section.items.map((item) => {
                const isExpanded = expandedFamilyKey === item.key;
                return (
                  <div className="transition-family-item" key={item.key}>
                    <TransitionItem
                      label={item.label}
                      transition={item.transition}
                      duration={duration}
                      capability={getTransitionCapability(item.transition)}
                      showCapabilityBadge={showCapabilityBadge}
                      variantCount={item.variantCount}
                      onClick={() => toggleFamily(item.key)}
                    />
                    {isExpanded ? (
                      <div className="transition-variant-list" aria-label={`${item.label} transition variants`}>
                        {item.variants.map((variant) => (
                          <TransitionItem
                            key={variant.id}
                            label={variant.name}
                            transition={variant}
                            duration={duration}
                            capability={getTransitionCapability(variant)}
                            showCapabilityBadge={showCapabilityBadge}
                            variant
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          );
        })}

        {visibleTransitionItems.length === 0 && (
          <div className="transitions-empty">
            {isSearchActive ? 'No transitions found' : 'No transitions available'}
          </div>
        )}
      </div>

      <div className="transitions-panel-footer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>Drag onto clip junction</span>
      </div>
    </div>
  );
}

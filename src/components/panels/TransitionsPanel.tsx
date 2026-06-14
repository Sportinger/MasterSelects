// Transitions Panel - Drag and drop transitions for timeline clips

import { useState, useCallback } from 'react';
import { getAllTransitions, getDefaultTransitionParams, type TransitionDefinition } from '../../transitions';
import {
  serializeTransitionDropData,
  setActiveTransitionDragData,
  TRANSITION_MIME_TYPE,
} from '../timeline/transitionDragData';
import './TransitionsPanel.css';

// Transition preview thumbnail component
function TransitionPreview({ type }: { type: string }) {
  if (type === 'crossfade' || type === 'dip-to-black' || type === 'dip-to-white') {
    const dipColor = type === 'dip-to-white' ? '#f4f4f5' : '#050505';
    const middleOpacity = type === 'crossfade' ? 0 : 0.9;
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <defs>
          <linearGradient id={`fadeOutGrad-${type}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4a9eff" stopOpacity="1" />
            <stop offset="100%" stopColor="#4a9eff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`fadeInGrad-${type}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff6b4a" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff6b4a" stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect x="0" y="8" width="50" height="24" fill={`url(#fadeOutGrad-${type})`} rx="2" />
        <rect x="30" y="8" width="50" height="24" fill={`url(#fadeInGrad-${type})`} rx="2" />
        <rect x="28" y="5" width="24" height="30" fill={dipColor} opacity={middleOpacity} rx="2" />
      </svg>
    );
  }

  if (type === 'wipe-left' || type === 'wipe-right') {
    const incomingX = type === 'wipe-right' ? 22 : 38;
    return (
      <svg viewBox="0 0 80 40" className="transition-preview-svg">
        <rect x="6" y="8" width="52" height="24" fill="#4a9eff" rx="2" />
        <rect x={incomingX} y="8" width="52" height="24" fill="#ff6b4a" rx="2" />
        <path
          d={type === 'wipe-right' ? 'M24 6v28' : 'M56 6v28'}
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.8"
        />
      </svg>
    );
  }

  // Default preview
  return (
    <svg viewBox="0 0 80 40" className="transition-preview-svg">
      <rect x="5" y="8" width="30" height="24" fill="#4a9eff" rx="2" />
      <rect x="45" y="8" width="30" height="24" fill="#ff6b4a" rx="2" />
      <path d="M38 20 L42 20" stroke="white" strokeWidth="2" />
    </svg>
  );
}

interface TransitionItemProps {
  transition: TransitionDefinition;
  duration: number;
}

function TransitionItem({ transition, duration }: TransitionItemProps) {
  const handleDragStart = useCallback((e: React.DragEvent) => {
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

    const label = document.createElement('span');
    label.textContent = transition.name;
    label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    dragEl.appendChild(label);

    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 42, 20);
    setTimeout(() => dragEl.remove(), 0);
  }, [transition, duration]);

  const handleDragEnd = useCallback(() => {
    setActiveTransitionDragData(null);
  }, []);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className="transition-item"
      title={transition.description}
    >
      <div className="transition-item-preview">
        <TransitionPreview type={transition.id} />
      </div>
      <span className="transition-item-name">{transition.name}</span>
    </div>
  );
}

export function TransitionsPanel() {
  const [duration, setDuration] = useState(2);
  const allTransitions = getAllTransitions();

  const handleDurationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value > 0) {
      setDuration(Math.max(value, 0.1));
    }
  }, []);

  return (
    <div className="transitions-panel">
      {/* Header with duration */}
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

      {/* Transitions list */}
      <div className="transitions-list">
        {allTransitions.map((transition) => (
          <TransitionItem
            key={transition.id}
            transition={transition}
            duration={duration}
          />
        ))}

        {allTransitions.length === 0 && (
          <div className="transitions-empty">
            No transitions available
          </div>
        )}
      </div>

      {/* Footer hint */}
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

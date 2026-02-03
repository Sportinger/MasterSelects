// Transitions Panel - Drag and drop transitions for timeline clips

import React, { useState, useCallback } from 'react';
import { getAllTransitions, getCategoriesWithTransitions, type TransitionDefinition } from '../../transitions';

// Default transition duration in seconds
const DEFAULT_DURATION = 0.5;

// MIME type for drag data
export const TRANSITION_MIME_TYPE = 'application/x-transition-type';

// Simple SVG icons for transitions
const TransitionIcons: Record<string, React.ReactNode> = {
  Blend: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v20M2 12h20" opacity="0.3" />
      <circle cx="8" cy="8" r="4" fill="currentColor" opacity="0.5" />
      <circle cx="16" cy="16" r="4" fill="currentColor" opacity="0.5" />
    </svg>
  ),
  default: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="8" height="18" rx="1" opacity="0.5" />
      <rect x="13" y="3" width="8" height="18" rx="1" opacity="0.5" />
      <path d="M11 12h2" strokeWidth="3" />
    </svg>
  ),
};

interface TransitionItemProps {
  transition: TransitionDefinition;
  duration: number;
}

function TransitionItem({ transition, duration }: TransitionItemProps) {
  const icon = TransitionIcons[transition.icon] || TransitionIcons.default;

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData(TRANSITION_MIME_TYPE, JSON.stringify({
      type: transition.id,
      duration,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, [transition.id, duration]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="flex flex-col items-center p-3 bg-zinc-800 rounded-lg cursor-grab hover:bg-zinc-700 transition-colors active:cursor-grabbing"
      title={transition.description}
    >
      <div className="w-12 h-12 flex items-center justify-center bg-zinc-900 rounded-md mb-2 text-zinc-400">
        {icon}
      </div>
      <span className="text-xs text-zinc-300 text-center">{transition.name}</span>
    </div>
  );
}

export function TransitionsPanel() {
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const categoriesWithTransitions = getCategoriesWithTransitions();
  const allTransitions = getAllTransitions();

  const handleDurationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value > 0) {
      setDuration(Math.min(Math.max(value, 0.1), 5.0));
    }
  }, []);

  return (
    <div className="h-full flex flex-col bg-zinc-900 text-white">
      {/* Duration control */}
      <div className="p-3 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400">Duration:</label>
          <input
            type="number"
            value={duration}
            onChange={handleDurationChange}
            min={0.1}
            max={5.0}
            step={0.1}
            className="w-16 px-2 py-1 text-xs bg-zinc-800 border border-zinc-600 rounded text-white focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-zinc-500">sec</span>
        </div>
      </div>

      {/* Transitions grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {categoriesWithTransitions.length > 0 ? (
          categoriesWithTransitions.map(({ category, transitions }) => (
            <div key={category} className="mb-4">
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 capitalize">
                {category}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {transitions.map((transition) => (
                  <TransitionItem
                    key={transition.id}
                    transition={transition}
                    duration={duration}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {allTransitions.map((transition) => (
              <TransitionItem
                key={transition.id}
                transition={transition}
                duration={duration}
              />
            ))}
          </div>
        )}

        {allTransitions.length === 0 && (
          <div className="text-center text-zinc-500 text-sm py-8">
            No transitions available
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="p-3 border-t border-zinc-700">
        <p className="text-xs text-zinc-500">
          Drag a transition and drop it on the junction between two clips.
        </p>
      </div>
    </div>
  );
}

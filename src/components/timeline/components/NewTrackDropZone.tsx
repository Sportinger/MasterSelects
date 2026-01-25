// Drop zone for creating new tracks

import React from 'react';
import type { ExternalDragState } from '../types';

interface NewTrackDropZoneProps {
  type: 'video' | 'audio';
  externalDrag: ExternalDragState | null;
  timeToPixel: (time: number) => number;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function NewTrackDropZone({
  type,
  externalDrag,
  timeToPixel,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}: NewTrackDropZoneProps) {
  if (!externalDrag) return null;

  const isActive = externalDrag.newTrackType === type;

  return (
    <div
      className={`new-track-drop-zone ${type} ${isActive ? 'active' : ''}`}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="drop-zone-label">
        + Drop to create new {type === 'video' ? 'Video' : 'Audio'} Track
      </span>
      {isActive && (
        <div
          className={`timeline-clip-preview ${type}`}
          style={{
            left: timeToPixel(externalDrag.startTime),
            width: timeToPixel(externalDrag.duration ?? 5),
          }}
        >
          <div className="clip-content">
            <span className="clip-name">New clip</span>
          </div>
        </div>
      )}
    </div>
  );
}

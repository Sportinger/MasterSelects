// WebVJ Mixer - Main Application

import { useState, useCallback, useRef, useEffect } from 'react';
import { Preview, LayerPanel, EffectsPanel, Toolbar, Timeline } from './components';
import './App.css';

type ViewTab = 'slots' | 'timeline';

interface PreviewPosition {
  x: number;
  y: number;
}

function App() {
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>('timeline');

  // Draggable preview state
  const [previewPosition, setPreviewPosition] = useState<PreviewPosition>({ x: 16, y: 100 });
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const [previewSize, setPreviewSize] = useState({ width: 400, height: 250 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const previewRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX;
      setSidebarWidth(Math.max(280, Math.min(600, newWidth)));
    }
    if (isDraggingPreview) {
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
      // Keep preview within bounds
      const maxX = window.innerWidth - previewSize.width - 16;
      const maxY = window.innerHeight - previewSize.height - 16;
      setPreviewPosition({
        x: Math.max(16, Math.min(maxX, newX)),
        y: Math.max(56, Math.min(maxY, newY)), // 56px accounts for toolbar
      });
    }
  }, [isResizing, isDraggingPreview, previewSize]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    setIsDraggingPreview(false);
  }, []);

  // Preview drag handlers
  const handlePreviewDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingPreview(true);
    dragOffset.current = {
      x: e.clientX - previewPosition.x,
      y: e.clientY - previewPosition.y,
    };
  }, [previewPosition]);

  return (
    <div
      className={`app ${isResizing ? 'resizing' : ''} ${isDraggingPreview ? 'dragging-preview' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="main-content">
        <main className="left-column">
          <Toolbar />
          {/* Tab navigation */}
          <div className="view-tabs">
            <button
              className={`tab-btn ${activeTab === 'slots' ? 'active' : ''}`}
              onClick={() => setActiveTab('slots')}
            >
              Slots
            </button>
            <button
              className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              Timeline
            </button>
          </div>
          {/* Tab content */}
          <div className="slots-area">
            {activeTab === 'slots' ? <LayerPanel /> : <Timeline />}
          </div>
        </main>
        <div className="resize-handle" onMouseDown={handleMouseDown} />
        <aside className="right-column" style={{ width: sidebarWidth }}>
          <div className="effects-section">
            <EffectsPanel />
          </div>
        </aside>
      </div>

      {/* Floating draggable preview */}
      <div
        ref={previewRef}
        className="floating-preview"
        style={{
          left: previewPosition.x,
          top: previewPosition.y,
          width: previewSize.width,
        }}
      >
        <div
          className="floating-preview-header"
          onMouseDown={handlePreviewDragStart}
        >
          <span className="drag-handle">⋮⋮</span>
          <span>Preview</span>
        </div>
        <Preview />
      </div>
    </div>
  );
}

export default App;

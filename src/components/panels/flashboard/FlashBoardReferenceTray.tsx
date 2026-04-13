import { useState, useCallback } from 'react';

interface ReferenceTrayProps {
  startThumbnail?: string | null;
  endThumbnail?: string | null;
  onStartChange?: (file: File | null) => void;
  onEndChange?: (file: File | null) => void;
}

export function FlashBoardReferenceTray({
  startThumbnail,
  endThumbnail,
  onStartChange,
  onEndChange,
}: ReferenceTrayProps) {
  const [startDragOver, setStartDragOver] = useState(false);
  const [endDragOver, setEndDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleStartDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setStartDragOver(true);
  }, []);

  const handleStartDragLeave = useCallback(() => {
    setStartDragOver(false);
  }, []);

  const handleStartDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setStartDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      onStartChange?.(file);
    }
  }, [onStartChange]);

  const handleEndDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setEndDragOver(true);
  }, []);

  const handleEndDragLeave = useCallback(() => {
    setEndDragOver(false);
  }, []);

  const handleEndDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setEndDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      onEndChange?.(file);
    }
  }, [onEndChange]);

  return (
    <div className="flashboard-reference-tray">
      <h4>Reference Frames</h4>
      <div className="flashboard-reference-slots">
        <div className="flashboard-reference-slot">
          <label>Start Frame</label>
          <div
            className={`flashboard-drop-zone ${startDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragEnter={handleStartDragEnter}
            onDragLeave={handleStartDragLeave}
            onDrop={handleStartDrop}
          >
            {startThumbnail ? (
              <>
                <img src={startThumbnail} alt="Start frame" />
                <button
                  className="remove-ref"
                  onClick={(e) => { e.stopPropagation(); onStartChange?.(null); }}
                >
                  x
                </button>
              </>
            ) : (
              <span>Drop image</span>
            )}
          </div>
        </div>

        <div className="flashboard-reference-slot">
          <label>End Frame</label>
          <div
            className={`flashboard-drop-zone ${endDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragEnter={handleEndDragEnter}
            onDragLeave={handleEndDragLeave}
            onDrop={handleEndDrop}
          >
            {endThumbnail ? (
              <>
                <img src={endThumbnail} alt="End frame" />
                <button
                  className="remove-ref"
                  onClick={(e) => { e.stopPropagation(); onEndChange?.(null); }}
                >
                  x
                </button>
              </>
            ) : (
              <span>Drop image</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import './SourceMonitorImageCrop.css';
import type { MediaFile } from '../../../stores/mediaStore';
import type { SourceMonitorImageCropSelection } from './sourceMonitorImageCropFile';

const MIN_CROP_SIZE = 32;
const CROP_HANDLES = ['nw', 'ne', 'sw', 'se'] as const;

type CropHandle = typeof CROP_HANDLES[number];
type CropDragMode = 'move' | CropHandle;

interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceMonitorImageCropApplyRequest {
  image: HTMLImageElement;
  crop: SourceMonitorImageCropSelection;
}

interface SourceMonitorImageCropProps {
  file: MediaFile;
  busy: boolean;
  error: string | null;
  onApply: (request: SourceMonitorImageCropApplyRequest) => Promise<void>;
  onCancel: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getInitialCropBox(imageBox: CropBox): CropBox {
  const width = Math.max(MIN_CROP_SIZE, imageBox.width * 0.8);
  const height = Math.max(MIN_CROP_SIZE, imageBox.height * 0.8);
  return {
    x: imageBox.x + (imageBox.width - width) / 2,
    y: imageBox.y + (imageBox.height - height) / 2,
    width,
    height,
  };
}

function clampCropBox(crop: CropBox, imageBox: CropBox): CropBox {
  const width = clamp(crop.width, MIN_CROP_SIZE, imageBox.width);
  const height = clamp(crop.height, MIN_CROP_SIZE, imageBox.height);
  return {
    x: clamp(crop.x, imageBox.x, imageBox.x + imageBox.width - width),
    y: clamp(crop.y, imageBox.y, imageBox.y + imageBox.height - height),
    width,
    height,
  };
}

function getMovedCropBox(start: CropBox, imageBox: CropBox, dx: number, dy: number): CropBox {
  return clampCropBox({
    ...start,
    x: start.x + dx,
    y: start.y + dy,
  }, imageBox);
}

function getResizedCropBox(
  mode: CropHandle,
  start: CropBox,
  imageBox: CropBox,
  dx: number,
  dy: number,
): CropBox {
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;

  if (mode.includes('w')) {
    left = clamp(start.x + dx, imageBox.x, right - MIN_CROP_SIZE);
  }
  if (mode.includes('e')) {
    right = clamp(start.x + start.width + dx, left + MIN_CROP_SIZE, imageBox.x + imageBox.width);
  }
  if (mode.includes('n')) {
    top = clamp(start.y + dy, imageBox.y, bottom - MIN_CROP_SIZE);
  }
  if (mode.includes('s')) {
    bottom = clamp(start.y + start.height + dy, top + MIN_CROP_SIZE, imageBox.y + imageBox.height);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function cropBoxToNaturalSelection(crop: CropBox, imageBox: CropBox, image: HTMLImageElement): SourceMonitorImageCropSelection {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const scaleX = naturalWidth / Math.max(1, imageBox.width);
  const scaleY = naturalHeight / Math.max(1, imageBox.height);
  const x = clamp(Math.round((crop.x - imageBox.x) * scaleX), 0, naturalWidth - 1);
  const y = clamp(Math.round((crop.y - imageBox.y) * scaleY), 0, naturalHeight - 1);

  return {
    x,
    y,
    width: clamp(Math.round(crop.width * scaleX), 1, naturalWidth - x),
    height: clamp(Math.round(crop.height * scaleY), 1, naturalHeight - y),
  };
}

export function SourceMonitorImageCrop({
  file,
  busy,
  error,
  onApply,
  onCancel,
}: SourceMonitorImageCropProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    mode: CropDragMode;
    startX: number;
    startY: number;
    startCrop: CropBox;
  } | null>(null);
  const [imageBox, setImageBox] = useState<CropBox | null>(null);
  const [cropBox, setCropBox] = useState<CropBox | null>(null);

  const updateImageBox = useCallback((resetCrop = false) => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image || !image.complete) return;

    const stageRect = stage.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const nextImageBox = {
      x: imageRect.left - stageRect.left,
      y: imageRect.top - stageRect.top,
      width: imageRect.width,
      height: imageRect.height,
    };

    if (nextImageBox.width <= 0 || nextImageBox.height <= 0) return;

    setImageBox(nextImageBox);
    setCropBox((current) => (
      resetCrop || !current
        ? getInitialCropBox(nextImageBox)
        : clampCropBox(current, nextImageBox)
    ));
  }, []);

  useLayoutEffect(() => {
    updateImageBox(true);
  }, [file.id, updateImageBox]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => updateImageBox(false));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [updateImageBox]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !imageBox) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setCropBox(drag.mode === 'move'
        ? getMovedCropBox(drag.startCrop, imageBox, dx, dy)
        : getResizedCropBox(drag.mode, drag.startCrop, imageBox, dx, dy));
    };
    const handlePointerUp = () => {
      dragRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [imageBox]);

  const startDrag = useCallback((mode: CropDragMode, event: ReactPointerEvent) => {
    if (busy || !cropBox) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: cropBox,
    };
  }, [busy, cropBox]);

  const applyCrop = useCallback(() => {
    const image = imageRef.current;
    if (!image || !imageBox || !cropBox || busy) return;

    void onApply({
      image,
      crop: cropBoxToNaturalSelection(cropBox, imageBox, image),
    });
  }, [busy, cropBox, imageBox, onApply]);

  const resetCrop = useCallback(() => {
    if (!imageBox) return;
    setCropBox(getInitialCropBox(imageBox));
  }, [imageBox]);

  const shadeRects = imageBox && cropBox ? {
    top: { left: imageBox.x, top: imageBox.y, width: imageBox.width, height: cropBox.y - imageBox.y },
    left: { left: imageBox.x, top: cropBox.y, width: cropBox.x - imageBox.x, height: cropBox.height },
    right: {
      left: cropBox.x + cropBox.width,
      top: cropBox.y,
      width: imageBox.x + imageBox.width - cropBox.x - cropBox.width,
      height: cropBox.height,
    },
    bottom: {
      left: imageBox.x,
      top: cropBox.y + cropBox.height,
      width: imageBox.width,
      height: imageBox.y + imageBox.height - cropBox.y - cropBox.height,
    },
  } : null;

  return (
    <div ref={stageRef} className="source-monitor-image-crop">
      <img
        ref={imageRef}
        src={file.url}
        alt={file.name}
        draggable={false}
        onLoad={() => updateImageBox(true)}
      />

      {shadeRects && Object.entries(shadeRects).map(([key, rect]) => (
        <div
          key={key}
          className="source-monitor-image-crop-shade"
          style={rect}
        />
      ))}

      {cropBox && (
        <div
          className="source-monitor-image-crop-box"
          style={{
            left: cropBox.x,
            top: cropBox.y,
            width: cropBox.width,
            height: cropBox.height,
          }}
          onPointerDown={(event) => startDrag('move', event)}
        >
          {CROP_HANDLES.map((handle) => (
            <button
              key={handle}
              type="button"
              className={`source-monitor-image-crop-handle ${handle}`}
              onPointerDown={(event) => startDrag(handle, event)}
              aria-label={`Resize crop ${handle}`}
            />
          ))}
        </div>
      )}

      <div className="source-monitor-image-crop-controls">
        <button type="button" className="btn btn-sm" onClick={applyCrop} disabled={busy || !cropBox}>
          {busy ? 'Saving' : 'Apply'}
        </button>
        <button type="button" className="btn btn-sm" onClick={resetCrop} disabled={busy || !imageBox}>
          Reset
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>

      {(busy || error) && (
        <div className={`source-monitor-image-crop-status ${error ? 'error' : ''}`}>
          {error ?? 'Creating cropped media file...'}
        </div>
      )}
    </div>
  );
}

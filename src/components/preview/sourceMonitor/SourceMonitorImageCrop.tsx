import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import './SourceMonitorImageCrop.css';
import type { MediaFile } from '../../../stores/mediaStore';
import type { SourceMonitorImageCropSelection } from './sourceMonitorImageCropFile';

const MIN_CROP_SIZE = 32;
const CROP_MAX_ZOOM = 128;
const CROP_ZOOM_STEP = 0.001;
const CROP_HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
const CROP_ASPECT_PRESETS = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
] as const;

type CropHandle = typeof CROP_HANDLES[number];
type CropDragMode = 'move' | CropHandle;

interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropViewportState {
  fileId: string;
  panX: number;
  panY: number;
  zoom: number;
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

function getNextCropZoom(current: number, deltaY: number, maxZoom: number): number {
  return clamp(current * Math.exp(-deltaY * CROP_ZOOM_STEP), 1, maxZoom);
}

function getDefaultCropViewport(fileId: string): CropViewportState {
  return { fileId, panX: 0, panY: 0, zoom: 1 };
}

function moveBox(box: CropBox, dx: number, dy: number): CropBox {
  return { ...box, x: box.x + dx, y: box.y + dy };
}

function scaleBoxFromAnchor(box: CropBox, anchorX: number, anchorY: number, scale: number): CropBox {
  return {
    x: anchorX + (box.x - anchorX) * scale,
    y: anchorY + (box.y - anchorY) * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
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

function fitCropBoxToAspect(crop: CropBox, imageBox: CropBox, aspectRatio: number): CropBox {
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  let width = crop.width;
  let height = crop.height;

  if (width / Math.max(1, height) > aspectRatio) {
    width = height * aspectRatio;
  } else {
    height = width / aspectRatio;
  }
  if (width > imageBox.width) {
    width = imageBox.width;
    height = width / aspectRatio;
  }
  if (height > imageBox.height) {
    height = imageBox.height;
    width = height * aspectRatio;
  }

  return clampCropBox({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }, imageBox);
}

function getAspectLockedResizeBox(
  mode: CropHandle,
  start: CropBox,
  imageBox: CropBox,
  dx: number,
  dy: number,
  aspectRatio: number,
): CropBox {
  const anchorX = mode.includes('w') ? start.x + start.width : start.x;
  const anchorY = mode.includes('n') ? start.y + start.height : start.y;
  const horizontalSign = mode.includes('e') ? 1 : -1;
  const verticalSign = mode.includes('s') ? 1 : -1;
  const requestedWidth = start.width + horizontalSign * dx;
  const requestedHeight = start.height + verticalSign * dy;
  const widthDrives = Math.abs(requestedWidth - start.width) >= Math.abs(requestedHeight - start.height);
  const maxWidth = horizontalSign > 0 ? imageBox.x + imageBox.width - anchorX : anchorX - imageBox.x;
  const maxHeight = verticalSign > 0 ? imageBox.y + imageBox.height - anchorY : anchorY - imageBox.y;
  const maxAspectWidth = Math.min(maxWidth, maxHeight * aspectRatio);
  const minAspectWidth = Math.min(maxAspectWidth, Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * aspectRatio));
  let width = widthDrives ? requestedWidth : requestedHeight * aspectRatio;

  width = clamp(width, minAspectWidth, maxAspectWidth);
  const height = width / aspectRatio;

  return {
    x: horizontalSign > 0 ? anchorX : anchorX - width,
    y: verticalSign > 0 ? anchorY : anchorY - height,
    width,
    height,
  };
}

function getResizedCropBox(
  mode: CropHandle,
  start: CropBox,
  imageBox: CropBox,
  dx: number,
  dy: number,
  aspectRatio: number | null,
): CropBox {
  if (aspectRatio !== null) {
    return getAspectLockedResizeBox(mode, start, imageBox, dx, dy, aspectRatio);
  }

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

  const resized = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
  return resized;
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
  const panDragRef = useRef<{
    fileId: string;
    startCropBox: CropBox | null;
    startImageBox: CropBox | null;
    startPanX: number;
    startPanY: number;
    startX: number;
    startY: number;
    zoom: number;
  } | null>(null);
  const [imageBox, setImageBox] = useState<CropBox | null>(null);
  const [cropBox, setCropBox] = useState<CropBox | null>(null);
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);
  const [imageViewportState, setImageViewportState] = useState(() => getDefaultCropViewport(file.id));
  const imageViewport = imageViewportState.fileId === file.id
    ? imageViewportState
    : getDefaultCropViewport(file.id);

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
        : getResizedCropBox(drag.mode, drag.startCrop, imageBox, dx, dy, cropAspectRatio));
    };
    const handlePointerUp = () => {
      dragRef.current = null;
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [cropAspectRatio, imageBox]);

  const startDrag = useCallback((mode: CropDragMode, event: ReactPointerEvent) => {
    if (event.button !== 0 || busy || !cropBox) return;
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
    const nextCrop = getInitialCropBox(imageBox);
    setCropBox(cropAspectRatio === null ? nextCrop : fitCropBoxToAspect(nextCrop, imageBox, cropAspectRatio));
  }, [cropAspectRatio, imageBox]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const stageRect = event.currentTarget.getBoundingClientRect();
    const anchorX = event.clientX - stageRect.left;
    const anchorY = event.clientY - stageRect.top;
    const zoom = getNextCropZoom(imageViewport.zoom, event.deltaY, CROP_MAX_ZOOM);
    const scale = zoom / imageViewport.zoom;
    setImageViewportState(zoom === 1
      ? getDefaultCropViewport(file.id)
      : {
        fileId: file.id,
        panX: anchorX - stageRect.width / 2 - scale * (anchorX - stageRect.width / 2 - imageViewport.panX),
        panY: anchorY - stageRect.height / 2 - scale * (anchorY - stageRect.height / 2 - imageViewport.panY),
        zoom,
      });
    setImageBox((current) => current ? scaleBoxFromAnchor(current, anchorX, anchorY, scale) : current);
    setCropBox((current) => current ? scaleBoxFromAnchor(current, anchorX, anchorY, scale) : current);
    if (zoom === 1) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => updateImageBox(false));
      } else {
        updateImageBox(false);
      }
    }
  }, [file.id, imageViewport.panX, imageViewport.panY, imageViewport.zoom, updateImageBox]);

  const startPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    panDragRef.current = {
      fileId: file.id,
      startCropBox: cropBox,
      startImageBox: imageBox,
      startPanX: imageViewport.panX,
      startPanY: imageViewport.panY,
      startX: event.clientX,
      startY: event.clientY,
      zoom: imageViewport.zoom,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = panDragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      setImageViewportState({
        fileId: drag.fileId,
        panX: drag.startPanX + dx,
        panY: drag.startPanY + dy,
        zoom: drag.zoom,
      });
      setImageBox(drag.startImageBox ? moveBox(drag.startImageBox, dx, dy) : null);
      setCropBox(drag.startCropBox ? moveBox(drag.startCropBox, dx, dy) : null);
    };
    const handlePointerUp = () => {
      panDragRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [cropBox, file.id, imageBox, imageViewport.panX, imageViewport.panY, imageViewport.zoom]);

  const selectAspectPreset = useCallback((aspectRatio: number | null) => {
    setCropAspectRatio(aspectRatio);
    if (aspectRatio === null || !imageBox) return;
    setCropBox((current) => current ? fitCropBoxToAspect(current, imageBox, aspectRatio) : current);
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
    <div
      ref={stageRef}
      className="source-monitor-image-crop"
      onWheel={handleWheel}
      onPointerDown={startPan}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
    >
      <img
        ref={imageRef}
        src={file.url}
        alt={file.name}
        draggable={false}
        onLoad={() => updateImageBox(true)}
        style={{ transform: `translate(${imageViewport.panX}px, ${imageViewport.panY}px) scale(${imageViewport.zoom})` }}
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
        <div className="source-monitor-image-crop-presets" aria-label="Crop aspect ratio presets">
          {CROP_ASPECT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`btn btn-sm source-monitor-image-crop-preset ${cropAspectRatio === preset.ratio ? 'btn-active' : ''}`}
              onClick={() => selectAspectPreset(preset.ratio)}
              disabled={busy || !cropBox}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="source-monitor-image-crop-actions">
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
      </div>

      {(busy || error) && (
        <div className={`source-monitor-image-crop-status ${error ? 'error' : ''}`}>
          {error ?? 'Creating cropped media file...'}
        </div>
      )}
    </div>
  );
}

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

interface PreviewSize {
  width: number;
  height: number;
}

interface UsePreviewViewportOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  effectiveResolution: PreviewSize;
  exportPreviewCanvasRef: RefObject<HTMLCanvasElement | null>;
  exportPreviewFrame: ImageBitmap | null;
  isExporting: boolean;
  setCanvasSize: Dispatch<SetStateAction<PreviewSize>>;
  setContainerSize: Dispatch<SetStateAction<PreviewSize>>;
}

export function usePreviewViewport({
  containerRef,
  effectiveResolution,
  exportPreviewCanvasRef,
  exportPreviewFrame,
  isExporting,
  setCanvasSize,
  setContainerSize,
}: UsePreviewViewportOptions): void {
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) return;

      setContainerSize({ width: containerWidth, height: containerHeight });

      const videoAspect = effectiveResolution.width / effectiveResolution.height;
      const containerAspect = containerWidth / containerHeight;

      let width: number;
      let height: number;

      if (containerAspect > videoAspect) {
        height = containerHeight;
        width = height * videoAspect;
      } else {
        width = containerWidth;
        height = width / videoAspect;
      }

      setCanvasSize({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [containerRef, effectiveResolution.width, effectiveResolution.height, setCanvasSize, setContainerSize]);

  useEffect(() => {
    const canvas = exportPreviewCanvasRef.current;
    if (!canvas || !isExporting || !exportPreviewFrame) return;

    if (canvas.width !== exportPreviewFrame.width) canvas.width = exportPreviewFrame.width;
    if (canvas.height !== exportPreviewFrame.height) canvas.height = exportPreviewFrame.height;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(exportPreviewFrame, 0, 0);
  }, [exportPreviewCanvasRef, exportPreviewFrame, isExporting]);
}

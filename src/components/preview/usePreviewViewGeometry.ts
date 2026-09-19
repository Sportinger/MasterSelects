import { useMemo, type CSSProperties } from 'react';

interface PreviewSize {
  width: number;
  height: number;
}

interface PreviewPoint {
  x: number;
  y: number;
}

interface CanvasRect extends PreviewSize, PreviewPoint {}

interface UsePreviewViewGeometryOptions {
  canvasSize: PreviewSize;
  containerSize: PreviewSize;
  viewNavigationEnabled: boolean;
  viewPan: PreviewPoint;
  viewZoom: number;
}

interface PreviewViewGeometry {
  canvasInContainer: CanvasRect;
  viewTransform: CSSProperties;
}

export function usePreviewViewGeometry({
  canvasSize,
  containerSize,
  viewNavigationEnabled,
  viewPan,
  viewZoom,
}: UsePreviewViewGeometryOptions): PreviewViewGeometry {
  const canvasInContainer = useMemo(() => {
    const scaledWidth = canvasSize.width * viewZoom;
    const scaledHeight = canvasSize.height * viewZoom;

    const centerX = (containerSize.width - scaledWidth) / 2;
    const centerY = (containerSize.height - scaledHeight) / 2;

    return {
      x: centerX + viewPan.x,
      y: centerY + viewPan.y,
      width: scaledWidth,
      height: scaledHeight,
    };
  }, [canvasSize, containerSize, viewPan, viewZoom]);

  const viewTransform = useMemo(
    () => viewNavigationEnabled
      ? {
          transform: `scale(${viewZoom}) translate(${viewPan.x / viewZoom}px, ${viewPan.y / viewZoom}px)`,
        }
      : {},
    [viewNavigationEnabled, viewPan.x, viewPan.y, viewZoom],
  );

  return {
    canvasInContainer,
    viewTransform,
  };
}

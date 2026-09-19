export interface ThumbnailRect {
  width: number;
  height: number;
  x: number;
  y: number;
}

export function fitThumbnailToWidthRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): ThumbnailRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { width: 0, height: 0, x: 0, y: 0 };
  }

  const scale = targetWidth / sourceWidth;
  const width = targetWidth;
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    width,
    height,
    x: Math.floor((targetWidth - width) / 2),
    y: Math.floor((targetHeight - height) / 2),
  };
}

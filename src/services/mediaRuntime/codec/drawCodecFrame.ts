/** Die Container-Drehung gilt auch für Canvas-Vorschauen und Proxy-Bilder. */
export function drawCodecFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  width: number,
  height: number,
  rotation = 0,
): void {
  const angle = ((rotation % 360) + 360) % 360;
  if (angle === 0) { context.drawImage(frame, 0, 0, width, height); return; }
  const swapsAxes = angle === 90 || angle === 270;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(angle * Math.PI / 180);
  const drawWidth = swapsAxes ? height : width;
  const drawHeight = swapsAxes ? width : height;
  context.drawImage(frame, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

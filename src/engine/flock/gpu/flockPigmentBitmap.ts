/** Shared main/Worker decode policy; caller owns and must close the bitmap. */
export async function loadFlockPigmentBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Flock pigment fetch failed (${response.status})`);
  const blob = await response.blob();
  const probe = await createImageBitmap(blob);
  const width = probe.width, height = probe.height;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  if (scale >= 1) return probe;
  probe.close();
  return createImageBitmap(blob, {
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: 'high',
  });
}

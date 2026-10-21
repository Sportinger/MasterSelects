// Shared by the docs picture scripts (effect-graph-shot.mjs, effect-editor-shot.mjs, effect-lab.mjs):
// encodes a Playwright PNG screenshot as WebP inside the page (Chrome's encoder), lowering quality
// and then width until it fits the byte budget. `pair: true` keeps a compare pair (two halves of the
// same size side by side) an even width and scales each half on its own, so no pixel of one half
// bleeds into the other.
export async function encodeDocShotWebp(page, png, { maxBytes = 200000, maxPixelWidth = 1600, pair = false } = {}) {
  const encoded = await page.evaluate(async ({ data, maxBytes, maxPixelWidth, pair }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const fit = value => (pair ? Math.floor(value / 2) * 2 : Math.round(value));
    let width = fit(Math.min(bitmap.width, maxPixelWidth)), quality = 0.92, blob;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const height = Math.round(bitmap.height * width / bitmap.width);
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      if (pair) {
        const source = bitmap.width / 2, half = width / 2;
        context.drawImage(bitmap, 0, 0, source, bitmap.height, 0, 0, half, height);
        context.drawImage(bitmap, source, 0, source, bitmap.height, half, 0, half, height);
      } else {
        context.drawImage(bitmap, 0, 0, width, height);
      }
      blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.size <= maxBytes) break;
      if (quality > 0.7) quality -= 0.08; else width = fit(width * 0.9);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(binary), size: blob.size, type: blob.type, width, height: Math.round(bitmap.height * width / bitmap.width),
      quality: Math.round(quality * 100) / 100 };
  }, { data: png.toString('base64'), maxBytes, maxPixelWidth, pair });
  if (encoded.type !== 'image/webp') throw new Error(`This browser cannot encode WebP (got ${encoded.type}).`);
  if (encoded.size > maxBytes) throw new Error(`${encoded.size} bytes even after shrinking; raise the byte budget or crop tighter.`);
  return { ...encoded, buffer: Buffer.from(encoded.base64, 'base64') };
}

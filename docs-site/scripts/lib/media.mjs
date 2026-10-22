// Size probes and byte budgets for the pictures and clips of the docs.
// Budgets (Style guide in docs/Features/Documentation-Site.md): WebP/PNG/JPEG ≤ 200 KB and
// ≤ 1600 px wide (scripts/docShotWebp.mjs), gallery thumbnails ≤ 30 KB, clips ≤ 1.5 MB and ≤ 12 s
// (the default of scripts/doc-clip.mjs; a control clip keeps to 700 KB and 8 s there). A whole page:
// its pictures and posters together about 1 MB, its clips together about 5 MB. Clips load only
// when the reader scrolls to them (preload none, played while on screen), so they get the larger share.

export const BUDGETS = { imageBytes: 200_000, imageWidth: 1600, thumbBytes: 30_000, clipBytes: 1_500_000, clipSeconds: 12 };
export const PAGE_BUDGETS = { pictureBytes: 1_000_000, clipBytes: 5_000_000 };
export const IMAGE_EXTENSIONS = /\.(?:webp|png|jpe?g|gif|avif|svg)$/iu;
export const VIDEO_EXTENSIONS = /\.(?:mp4|webm)$/iu;

/** Pixel size of a PNG, JPEG or WebP file, or undefined. */
export function imageSize(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ascii = (offset, length) => String.fromCharCode(...u8.subarray(offset, offset + length));
  if (u8.length > 24 && ascii(1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (u8.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: 1 + (u8[24] | u8[25] << 8 | u8[26] << 16), height: 1 + (u8[27] | u8[28] << 8 | u8[29] << 16) };
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') { const bits = view.getUint32(21, true); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
  }
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    for (let offset = 2; offset + 9 < u8.length;) {
      if (u8[offset] !== 0xff) return undefined;
      const marker = u8[offset + 1], length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
  }
  return undefined;
}

/** Duration (seconds) and picture size of an MP4 file from its moov box, or undefined. */
export function mp4Info(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const info = {};
  const walk = (start, end) => {
    for (let offset = start; offset + 8 <= end;) {
      let size = view.getUint32(offset);
      const type = String.fromCharCode(...u8.subarray(offset + 4, offset + 8));
      let header = 8;
      if (size === 1 && offset + 16 <= end) { size = Number(view.getBigUint64(offset + 8)); header = 16; }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) return;
      const body = offset + header;
      if (type === 'moov' || type === 'trak') walk(body, offset + size);
      if (type === 'mvhd') {
        const version = u8[body];
        const timescale = view.getUint32(body + (version === 1 ? 20 : 12));
        const duration = version === 1 ? Number(view.getBigUint64(body + 24)) : view.getUint32(body + 16);
        if (timescale) info.duration = duration / timescale;
      }
      if (type === 'tkhd' && !info.width) {
        const width = view.getUint32(offset + size - 8) / 65536, height = view.getUint32(offset + size - 4) / 65536;
        if (width && height) Object.assign(info, { width: Math.round(width), height: Math.round(height) });
      }
      offset += size;
    }
  };
  if (u8.length > 8) walk(0, u8.length);
  return info.duration !== undefined || info.width ? info : undefined;
}

const kb = (bytes) => `${Math.round(bytes / 1000)} KB`;

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

/**
 * Budget problems of a whole page, from the assets it uses (`Map` or entries of file → byte count).
 * A clip's .webm and .mp4 are alternatives: only the larger one counts.
 */
export function pageBudgetIssues(assets) {
  const clips = new Map();
  let pictures = 0;
  for (const [file, bytes] of assets) {
    if (VIDEO_EXTENSIONS.test(file)) {
      const stem = file.replace(VIDEO_EXTENSIONS, '');
      clips.set(stem, Math.max(clips.get(stem) ?? 0, bytes));
    } else if (IMAGE_EXTENSIONS.test(file)) pictures += bytes;
  }
  const clipBytes = [...clips.values()].reduce((sum, bytes) => sum + bytes, 0);
  const issues = [];
  if (pictures > PAGE_BUDGETS.pictureBytes) issues.push(`its pictures and posters add up to ${mb(pictures)} (page budget ${mb(PAGE_BUDGETS.pictureBytes)})`);
  if (clipBytes > PAGE_BUDGETS.clipBytes) issues.push(`its ${clips.size} clips add up to ${mb(clipBytes)} (page budget ${mb(PAGE_BUDGETS.clipBytes)})`);
  return issues;
}

/** Budget problems of one asset (path relative to docs/Features), as short sentences. */
export function assetBudgetIssues(file, bytes, { thumb = false } = {}) {
  const issues = [];
  if (VIDEO_EXTENSIONS.test(file)) {
    if (bytes.length > BUDGETS.clipBytes) issues.push(`${kb(bytes.length)} (clip budget ${kb(BUDGETS.clipBytes)})`);
    const duration = /\.mp4$/iu.test(file) ? mp4Info(bytes)?.duration : undefined;
    if (duration > BUDGETS.clipSeconds + 0.05) issues.push(`${duration.toFixed(1)} s long (clip budget ${BUDGETS.clipSeconds} s)`);
    return issues;
  }
  if (!IMAGE_EXTENSIONS.test(file) || /\.svg$/iu.test(file)) return issues;
  const limit = thumb ? BUDGETS.thumbBytes : BUDGETS.imageBytes;
  if (bytes.length > limit) issues.push(`${kb(bytes.length)} (${thumb ? 'thumbnail' : 'picture'} budget ${kb(limit)})`);
  const width = imageSize(bytes)?.width;
  if (width > BUDGETS.imageWidth) issues.push(`${width} px wide (budget ${BUDGETS.imageWidth} px)`);
  return issues;
}

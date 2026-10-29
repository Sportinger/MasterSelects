// FAST export demuxes sources with MP4Box, which reads only ISO-BMFF files (MP4, MOV, M4V).
// Other containers would fail deep inside the parser with an unrelated message, so the source
// header is checked first and the export stops with the container's name and the way out.
// Only containers recognised by their signature are refused; an unknown header still goes to
// the parser (fragmented or unusual MP4 layouts must not be refused by a guess), whose error
// names the clip and Precise export as well.

const ISO_BOX_TYPES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'styp', 'sidx', 'moof']);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/**
 * Returns a readable container name when the source is a container FAST export cannot read,
 * or null for ISO-BMFF and unrecognised headers. `header` needs the first 12 bytes of the file.
 */
export function describeFastUnsupportedContainer(header: Uint8Array): string | null {
  if (header.length >= 8 && ISO_BOX_TYPES.has(ascii(header, 4, 4))) return null;
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
    return 'WebM/Matroska';
  }
  if (header.length >= 12 && ascii(header, 0, 4) === 'RIFF') return ascii(header, 8, 4) === 'AVI ' ? 'AVI' : 'RIFF';
  if (header.length >= 4 && ascii(header, 0, 4) === 'OggS') return 'Ogg';
  // MPEG-TS: 188-byte packets starting with the sync byte 0x47 (a single byte is too weak alone).
  if (header.length >= 4 && header[0] === 0x47 && (header[1] & 0x80) === 0 && (header[3] & 0xc0) === 0) {
    return 'MPEG transport stream';
  }
  return null;
}

export function fastUnsupportedContainerMessage(container: string, clipName: string): string {
  return `FAST export failed: clip "${clipName}" is a ${container} file, which FAST export cannot read `
    + '(it reads MP4 and MOV). Use PRECISE (HTMLVideo) export for this clip.';
}

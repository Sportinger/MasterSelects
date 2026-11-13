// FAST export demuxes sources with MP4Box, which reads only ISO-BMFF files (MP4, MOV, M4V).
// Other containers would fail deep inside the parser with an unrelated message, so the source
// header is checked first. The export then continues in PRECISE mode (FrameExporter).
// Only containers recognised by their signature are refused; an unknown header still goes to
// the parser (fragmented or unusual MP4 layouts must not be refused by a guess), whose error
// names the clip and Precise export as well.

/** FAST export's demuxer cannot read this source; PRECISE mode goes through the browser's own decoder. */
export class FastSourceUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FastSourceUnreadableError';
  }
}

export function isFastSourceUnreadable(error: unknown): error is FastSourceUnreadableError {
  return error instanceof FastSourceUnreadableError;
}

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
  if (header.length >= 4 && header[0] === 0 && header[1] === 0 && header[2] === 1 && header[3] === 0xba) return 'MPEG program stream';
  if (header.length >= 3 && ascii(header, 0, 3) === 'ID3') return 'MP3';
  if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe6) === 0xe2) return 'MP3';
  return null;
}

export function fastUnsupportedContainerMessage(container: string, clipName: string): string {
  return `Clip "${clipName}" is a ${container} file, which FAST export cannot read (it reads MP4 and MOV).`;
}

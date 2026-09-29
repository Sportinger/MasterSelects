// Maps picture-essence-coding and essence-container ULs (SMPTE RP224 registry)
// to MasterSelects codec ids (plan E5).

export type MxfCodecFamily = 'prores' | 'dnxhd' | 'mpeg2' | 'avc' | 'jpeg2000' | 'unknown';

export type MxfUnsupportedReason = 'jpeg2000' | 'unknown-essence';

export interface MxfCodecIdentity {
  family: MxfCodecFamily;
  /**
   * Codec id stored on the media file. ProRes uses its real FourCC so it routes to
   * the TurboRes backend; other essence uses namespaced `mxf:*` ids.
   * `mxf:mpeg2` / `mxf:avc` are refined to `-intra` / `-lgop` once the index is known.
   */
  codecId: string | null;
  unsupportedReason?: MxfUnsupportedReason;
}

// bytes 8..13 of the picture coding UL (hex offsets 16..28)
const CODING_PRORES = '040102020306';
const CODING_DNXHD_PREFIX = '0401020271';
const CODING_MPEG2_PREFIX = '04010202010';
// 0x31 = AVC long-GOP family, 0x32 = AVC Intra profiles (RP224)
const CODING_AVC_PREFIX = '04010202013';
const CODING_JPEG2000 = '040102020301';

// ProRes UL profile byte -> FourCC (verified against FFmpeg-written files; see tests)
const PRORES_PROFILE_FOURCC: Record<number, string> = {
  0x01: 'apco',
  0x02: 'apcs',
  0x03: 'apcn',
  0x04: 'apch',
  0x05: 'ap4h',
  0x06: 'ap4x',
};

export function identifyMxfCodec(pictureCodingUl: string | undefined): MxfCodecIdentity {
  if (!pictureCodingUl || pictureCodingUl.length < 32) {
    return { family: 'unknown', codecId: null, unsupportedReason: 'unknown-essence' };
  }
  const body = pictureCodingUl.slice(16, 28);
  const profileByte = parseInt(pictureCodingUl.slice(28, 30), 16);
  if (body === CODING_PRORES) {
    const fourCC = PRORES_PROFILE_FOURCC[profileByte];
    return fourCC
      ? { family: 'prores', codecId: fourCC }
      : { family: 'prores', codecId: null, unsupportedReason: 'unknown-essence' };
  }
  if (body.startsWith(CODING_DNXHD_PREFIX)) return { family: 'dnxhd', codecId: 'mxf:dnxhd' };
  if (body.startsWith(CODING_AVC_PREFIX)) return { family: 'avc', codecId: 'mxf:avc' };
  if (body.startsWith(CODING_MPEG2_PREFIX)) {
    return { family: 'mpeg2', codecId: 'mxf:mpeg2' };
  }
  if (body === CODING_JPEG2000) {
    return { family: 'jpeg2000', codecId: null, unsupportedReason: 'jpeg2000' };
  }
  return { family: 'unknown', codecId: null, unsupportedReason: 'unknown-essence' };
}

/** SMPTE 386M D-10 mapping (MPEG-2 4:2:2 Intra with AES3 sound in the picture element). */
export function isD10EssenceContainer(essenceContainerUl: string | undefined): boolean {
  return !!essenceContainerUl && essenceContainerUl.slice(16, 26) === '0d01030102' && essenceContainerUl.slice(26, 28) === '01';
}

export function describeOperationalPattern(ul: string | undefined): string {
  if (!ul || ul.length < 32) return 'unknown';
  const item = parseInt(ul.slice(24, 26), 16);
  const pkg = parseInt(ul.slice(26, 28), 16);
  if (item === 0x10) return 'op-atom';
  const letter = 'abc'[pkg - 1] ?? '?';
  return `op${item}${letter}`;
}

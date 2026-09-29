// Derives the WebCodecs `avc1.PPCCLL` codec string from the SPS of an Annex-B
// access unit (MXF AVC essence is stored as an Annex-B byte stream, RP 2027).

const NAL_SPS = 7;

function findNal(data: Uint8Array, type: number): number {
  for (let i = 0; i + 4 < data.length; i += 1) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3]! & 0x1f) === type) {
      return i + 3;
    }
  }
  return -1;
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

/** Returns e.g. `avc1.640033`, or null when the access unit carries no SPS. */
export function getAvcCodecStringFromAnnexB(data: Uint8Array): string | null {
  const nal = findNal(data, NAL_SPS);
  if (nal < 0 || nal + 4 > data.length) return null;
  // nal: header byte, then profile_idc, constraint flags, level_idc
  return `avc1.${hex2(data[nal + 1]!)}${hex2(data[nal + 2]!)}${hex2(data[nal + 3]!)}`;
}

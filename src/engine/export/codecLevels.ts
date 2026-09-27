/**
 * Smallest standard codec level that fits an encode's picture size and
 * sample rate. WebCodecs rejects a codec string whose level is too low for
 * the configured frame (for example HEVC Level 3.1 at 3840x2160 60 fps).
 * Tables list [level token, max picture size, max sample rate]; the first
 * entry is the historical default so small exports keep their codec string.
 */

export interface CodecFrameSize {
  width: number;
  height: number;
  fps: number;
}

type LevelRow = readonly [token: string, maxPicture: number, maxRate: number];

// H.264 (Main profile): max frame size in macroblocks, max macroblocks per second.
const AVC_LEVELS: LevelRow[] = [
  ['28', 8192, 245760], // 4.0
  ['2a', 8704, 522240], // 4.2
  ['32', 22080, 589824], // 5.0
  ['33', 36864, 983040], // 5.1
  ['34', 36864, 2073600], // 5.2
  ['3c', 139264, 4177920], // 6.0
  ['3d', 139264, 8355840], // 6.1
  ['3e', 139264, 16711680], // 6.2
];

// HEVC Main tier: level_idc, max luma picture size, max luma sample rate.
const HEVC_LEVELS: LevelRow[] = [
  ['93', 983040, 33177600], // 3.1
  ['120', 2228224, 66846720], // 4.0
  ['123', 2228224, 133693440], // 4.1
  ['150', 8912896, 267386880], // 5.0
  ['153', 8912896, 534773760], // 5.1
  ['156', 8912896, 1069547520], // 5.2
  ['180', 35651584, 1069547520], // 6.0
  ['183', 35651584, 2139095040], // 6.1
  ['186', 35651584, 4278190080], // 6.2
];

// VP9: level, max luma picture size, max luma sample rate.
const VP9_LEVELS: LevelRow[] = [
  ['10', 36864, 829440],
  ['11', 73728, 2764800],
  ['20', 122880, 4608000],
  ['21', 245760, 9216000],
  ['30', 552960, 20736000],
  ['31', 983040, 36864000],
  ['40', 2228224, 83558400],
  ['41', 2228224, 160432128],
  ['50', 8912896, 311951360],
  ['51', 8912896, 588251136],
  ['52', 8912896, 1176502272],
  ['60', 35651584, 1176502272],
  ['61', 35651584, 2353004544],
  ['62', 35651584, 4706009088],
];

// AV1 Main profile: seq_level_idx, max picture size, max display rate.
const AV1_LEVELS: LevelRow[] = [
  ['04', 665856, 19975680], // 3.0
  ['05', 1065024, 31950720], // 3.1
  ['08', 2359296, 70778880], // 4.0
  ['09', 2359296, 141557760], // 4.1
  ['12', 8912896, 267386880], // 5.0
  ['13', 8912896, 534773760], // 5.1
  ['14', 8912896, 1069547520], // 5.2
  ['15', 8912896, 1069547520], // 5.3
  ['16', 35651584, 1069547520], // 6.0
  ['17', 35651584, 2139095040], // 6.1
  ['18', 35651584, 4278190080], // 6.2
];

function pickLevel(levels: LevelRow[], picture: number, rate: number): string {
  const fitting = levels.find(([, maxPicture, maxRate]) => picture <= maxPicture && rate <= maxRate);
  return (fitting ?? levels[levels.length - 1])[0];
}

function sanitize(frame: CodecFrameSize): CodecFrameSize {
  return {
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
    fps: Math.max(1, frame.fps),
  };
}

export function avcLevelToken(frame: CodecFrameSize): string {
  const { width, height, fps } = sanitize(frame);
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  return pickLevel(AVC_LEVELS, macroblocks, macroblocks * fps);
}

export function hevcLevelToken(frame: CodecFrameSize): string {
  const { width, height, fps } = sanitize(frame);
  return pickLevel(HEVC_LEVELS, width * height, width * height * fps);
}

export function vp9LevelToken(frame: CodecFrameSize): string {
  const { width, height, fps } = sanitize(frame);
  return pickLevel(VP9_LEVELS, width * height, width * height * fps);
}

export function av1LevelToken(frame: CodecFrameSize): string {
  const { width, height, fps } = sanitize(frame);
  return pickLevel(AV1_LEVELS, width * height, width * height * fps);
}

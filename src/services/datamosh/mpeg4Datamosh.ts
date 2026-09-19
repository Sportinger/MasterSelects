import { getFFmpegBridge } from '../../engine/ffmpeg';

const VOP_START_CODE = 0xb6;

export interface Mpeg4DatamoshInput {
  rgbaFrames: Uint8Array;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  inputFrameCount: number;
  outputFrameCount: number;
  onProgress?: (completed: number, total: number) => void;
}

function findStartCodes(bytes: Uint8Array, code: number): number[] {
  const positions: number[] = [];
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (
      bytes[index] === 0
      && bytes[index + 1] === 0
      && bytes[index + 2] === 1
      && bytes[index + 3] === code
    ) positions.push(index);
  }
  return positions;
}

function getVopType(bytes: Uint8Array, position: number): number {
  return bytes[position + 4] >> 6;
}

export function dropMpeg4DonorIFrame(encoded: Uint8Array): Uint8Array {
  const vops = findStartCodes(encoded, VOP_START_CODE);
  if (vops.length < 3 || getVopType(encoded, vops[0]) !== 0) {
    throw new Error('MPEG-4 stream did not begin with an anchor I-VOP.');
  }
  if (getVopType(encoded, vops[1]) !== 0) {
    throw new Error('MPEG-4 stream did not contain a donor I-VOP after the anchor.');
  }
  if (getVopType(encoded, vops[2]) !== 1) {
    throw new Error('MPEG-4 donor stream did not continue with predictive P-VOPs.');
  }

  // Both I-VOPs and all donor P-VOPs must live under the same VOL header.
  // Mixing an I-VOP from a separately encoded elementary stream can decode
  // as horizontal bands even when both encoders used identical settings.
  const beforeDonorI = encoded.subarray(0, vops[1]);
  const afterDonorI = encoded.subarray(vops[2]);
  const result = new Uint8Array(beforeDonorI.length + afterDonorI.length);
  result.set(beforeDonorI, 0);
  result.set(afterDonorI, beforeDonorI.length);
  return result;
}

export async function createMpeg4DatamoshFrames(input: Mpeg4DatamoshInput): Promise<Uint8Array> {
  const frameSize = input.width * input.height * 4;
  if (input.rgbaFrames.byteLength !== frameSize * input.inputFrameCount) {
    throw new Error('Datamosh raw-frame buffer has an unexpected size.');
  }
  if (input.inputFrameCount !== input.outputFrameCount + 1) {
    throw new Error('Datamosh needs one anchor plus a complete donor frame sequence.');
  }

  const ffmpeg = getFFmpegBridge();
  input.onProgress?.(0, 2);
  const codecArgs = [
    '-an',
    '-c:v', 'mpeg4',
    '-bf', '0',
    '-g', '600',
    '-sc_threshold', 'max',
    '-intra_penalty', 'max',
    '-flags', '+mv4',
    '-b:v', String(input.bitrate),
    '-pix_fmt', 'yuv420p',
    '-force_key_frames', 'expr:eq(n,0)+eq(n,1)',
    '-f', 'm4v',
  ];
  const encoded = await ffmpeg.runVirtualCommand({
    inputFiles: { '/input/datamosh.rgba': input.rgbaFrames },
    args: [
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-video_size', `${input.width}x${input.height}`,
      '-framerate', String(input.fps),
      '-i', '/input/datamosh.rgba',
      ...codecArgs,
      '-frames:v', String(input.inputFrameCount),
      '/output/source.m4v',
    ],
    outputPaths: ['/output/source.m4v'],
  });
  const corruptedStream = dropMpeg4DonorIFrame(encoded['/output/source.m4v']);
  input.onProgress?.(1, 2);

  const decoded = await ffmpeg.runVirtualCommand({
    inputFiles: { '/input/datamosh.m4v': corruptedStream },
    args: [
      '-err_detect', 'ignore_err',
      '-ec', '0',
      '-flags2', '+showall',
      '-f', 'm4v',
      '-framerate', String(input.fps),
      '-i', '/input/datamosh.m4v',
      '-frames:v', String(input.outputFrameCount),
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '/output/datamosh.rgba',
    ],
    outputPaths: ['/output/datamosh.rgba'],
  });
  const rgbaFrames = decoded['/output/datamosh.rgba'];
  const expectedBytes = frameSize * input.outputFrameCount;
  if (rgbaFrames.byteLength !== expectedBytes) {
    throw new Error(
      `MPEG-4 datamosh decoded ${Math.floor(rgbaFrames.byteLength / frameSize)} of ${input.outputFrameCount} frames.`,
    );
  }
  input.onProgress?.(2, 2);
  return rgbaFrames;
}

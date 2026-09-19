// HAP codec conformance probe (node-side, no browser required).
//
// Validates the pure-TS HAP stack in src/services/hap against ffmpeg as an
// independent reference implementation:
//   A. Snappy round-trips
//   B. CPU BC1/BC3/YCoCg encode -> our decode PSNR
//   C. HAP frame section round-trips (single + chunked)
//   D. Our encoder + muxer -> ffmpeg/ffprobe decode (interop, both flavors)
//   E. ffmpeg HAP encodes -> our parser/decoder (interop)
//   F. mediabunny demux of our own .mov (the editor import path)
//
// Run: npx esbuild tools/hap-probe/hapProbe.ts --bundle --platform=node \
//        --format=esm --packages=external --outfile=tools/hap-probe/.build/hapProbe.mjs
//      node tools/hap-probe/.build/hapProbe.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { snappyCompress, snappyUncompress } from '../../src/services/hap/snappy';
import {
  compressedTextureByteLength,
  encodeTextureCpu,
} from '../../src/services/hap/dxtEncodeCpu';
import { decodeTextureCpu } from '../../src/services/hap/dxtDecodeCpu';
import {
  HAP_FORMAT_RGBA_DXT5,
  HAP_FORMAT_RGB_DXT1,
  HAP_FORMAT_YCOCG_DXT5,
  buildHapFrame,
  parseHapFrame,
  type HapTextureFormatNibble,
} from '../../src/services/hap/hapFrame';
import { HapMovWriter } from '../../src/services/hap/hapMovMuxer';

const TMP = join(process.cwd(), 'tools', 'hap-probe', '.tmp');
const WIDTH = 192;
const HEIGHT = 108;
const FRAMES = 10;
const FPS = 30;

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function runTool(command: string, args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stderr}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function psnr(a: Uint8Array, b: Uint8Array, stride = 1, offset = 0): number {
  let sum = 0;
  let count = 0;
  for (let i = offset; i < Math.min(a.length, b.length); i += stride) {
    const diff = a[i] - b[i];
    sum += diff * diff;
    count++;
  }
  if (count === 0) return 0;
  const mse = sum / count;
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}

function psnrRgb(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = a[i + c] - b[i + c];
      sum += diff * diff;
      count++;
    }
  }
  const mse = sum / count;
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}

/** Smooth gradient + moving disc + alpha ramp: kind to BC, still non-trivial. */
function synthFrame(frameIndex: number): Uint8Array {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  const cx = WIDTH * (0.25 + 0.5 * (frameIndex / Math.max(1, FRAMES - 1)));
  const cy = HEIGHT / 2;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const inDisc = dx * dx + dy * dy < 24 * 24;
      rgba[i] = inDisc ? 230 : Math.round((x / WIDTH) * 255);
      rgba[i + 1] = inDisc ? 80 : Math.round((y / HEIGHT) * 255);
      rgba[i + 2] = inDisc ? 40 : Math.round(((x + y) / (WIDTH + HEIGHT)) * 255);
      rgba[i + 3] = Math.round((x / WIDTH) * 255);
    }
  }
  return rgba;
}

function testSnappy(): void {
  console.log('A. snappy');
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array([42]),
    new Uint8Array(100_000).fill(7),
    (() => {
      const buf = new Uint8Array(200_000);
      for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + ((i / 100) | 0)) & 0xff;
      return buf;
    })(),
    (() => {
      let seed = 1234567;
      const buf = new Uint8Array(150_000);
      for (let i = 0; i < buf.length; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        buf[i] = seed & 0xff;
      }
      return buf;
    })(),
  ];
  for (const [index, source] of cases.entries()) {
    const compressed = snappyCompress(source);
    const restored = snappyUncompress(compressed);
    const equal = restored.length === source.length
      && restored.every((value, i) => value === source[i]);
    check(
      `round-trip case ${index}`,
      equal,
      `${source.length} -> ${compressed.length} bytes`,
    );
  }
}

function testDxtCpu(): void {
  console.log('B. CPU BC encode/decode');
  const source = synthFrame(3);
  for (const [format, decodeAs, minDb] of [
    ['bc1', 'bc1', 30],
    ['bc3', 'bc3', 30],
    ['ycocg-bc3', 'ycocg-bc3', 30],
  ] as const) {
    const blocks = encodeTextureCpu(format, source, WIDTH, HEIGHT);
    check(
      `${format} size`,
      blocks.length === compressedTextureByteLength(format, WIDTH, HEIGHT),
      `${blocks.length} bytes`,
    );
    const decoded = decodeTextureCpu(decodeAs, blocks, WIDTH, HEIGHT);
    const rgbDb = psnrRgb(source, decoded);
    check(`${format} rgb psnr >= ${minDb}`, rgbDb >= minDb, `${rgbDb.toFixed(1)} dB`);
    if (format === 'bc3') {
      const alphaDb = psnr(source, decoded, 4, 3);
      check('bc3 alpha psnr >= 40', alphaDb >= 40, `${alphaDb.toFixed(1)} dB`);
    }
  }
}

function testFrameRoundTrip(): void {
  console.log('C. HAP frame sections');
  const source = synthFrame(5);
  const blocks = encodeTextureCpu('bc1', source, WIDTH, HEIGHT);
  for (const chunkCount of [1, 4]) {
    const frame = buildHapFrame({
      formatNibble: HAP_FORMAT_RGB_DXT1,
      texture: blocks,
      chunkCount,
    });
    const parsed = parseHapFrame(frame);
    const texture = parsed.textures[0];
    const equal = texture.data.length === blocks.length
      && texture.data.every((value, i) => value === blocks[i]);
    check(
      `chunks=${chunkCount} round-trip`,
      parsed.textures.length === 1 && texture.formatName === 'bc1' && equal,
      `${blocks.length} -> ${frame.length} bytes`,
    );
  }
}

interface EncodeFlavor {
  variant: 'hap' | 'hap-alpha' | 'hap-q';
  fourCC: string;
  format: 'bc1' | 'bc3' | 'ycocg-bc3';
  nibble: HapTextureFormatNibble;
  chunkCount: number;
  minSourceDb: number;
}

const ENCODE_FLAVORS: EncodeFlavor[] = [
  { variant: 'hap', fourCC: 'Hap1', format: 'bc1', nibble: HAP_FORMAT_RGB_DXT1, chunkCount: 1, minSourceDb: 28 },
  { variant: 'hap-alpha', fourCC: 'Hap5', format: 'bc3', nibble: HAP_FORMAT_RGBA_DXT5, chunkCount: 4, minSourceDb: 28 },
  { variant: 'hap-q', fourCC: 'HapY', format: 'ycocg-bc3', nibble: HAP_FORMAT_YCOCG_DXT5, chunkCount: 1, minSourceDb: 28 },
];

async function testEncodeInterop(): Promise<string> {
  console.log('D. our encode -> ffmpeg decode');
  const sourceFrames = Array.from({ length: FRAMES }, (_, i) => synthFrame(i));
  let firstMovPath = '';

  for (const flavor of ENCODE_FLAVORS) {
    const writer = new HapMovWriter({
      videoFourCC: flavor.fourCC,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      depth: flavor.fourCC === 'Hap5' ? 32 : 24,
    });
    for (const frame of sourceFrames) {
      const blocks = encodeTextureCpu(flavor.format, frame, WIDTH, HEIGHT);
      writer.addVideoSample(buildHapFrame({
        formatNibble: flavor.nibble,
        texture: blocks,
        chunkCount: flavor.chunkCount,
      }));
    }

    const audioFrames = Math.round((FRAMES / FPS) * 48000);
    const pcm = new Int16Array(audioFrames * 2);
    for (let i = 0; i < audioFrames; i++) {
      const value = Math.round(Math.sin((i / 48000) * 2 * Math.PI * 440) * 12000);
      pcm[i * 2] = value;
      pcm[i * 2 + 1] = value;
    }
    writer.setAudio({ samples: pcm, sampleRate: 48000, channelCount: 2 });

    const blob = writer.finalize();
    const movPath = join(TMP, `ours-${flavor.variant}.mov`);
    writeFileSync(movPath, new Uint8Array(await blob.arrayBuffer()));
    if (!firstMovPath) firstMovPath = movPath;

    const probe = JSON.parse(runTool('ffprobe', [
      '-v', 'error', '-of', 'json', '-show_streams', movPath,
    ]).stdout) as {
      streams: {
        codec_name?: string;
        codec_tag_string?: string;
        width?: number;
        height?: number;
        nb_frames?: string;
        sample_rate?: string;
      }[];
    };
    const video = probe.streams.find((s) => s.codec_name === 'hap');
    const audio = probe.streams.find((s) => s.codec_name === 'pcm_s16le');
    check(
      `${flavor.variant} ffprobe streams`,
      !!video && !!audio
        && video.codec_tag_string === flavor.fourCC
        && video.width === WIDTH && video.height === HEIGHT
        && audio.sample_rate === '48000',
      `tag=${video?.codec_tag_string} frames=${video?.nb_frames}`,
    );

    const rawPath = join(TMP, `ours-${flavor.variant}.raw`);
    runTool('ffmpeg', [
      '-v', 'error', '-y', '-i', movPath,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', rawPath,
    ]);
    const decoded = new Uint8Array(readFileSync(rawPath));
    const frameBytes = WIDTH * HEIGHT * 4;
    check(
      `${flavor.variant} ffmpeg frame count`,
      decoded.length === frameBytes * FRAMES,
      `${decoded.length / frameBytes} frames`,
    );

    let worstDb = Infinity;
    for (let i = 0; i < FRAMES; i++) {
      const db = psnrRgb(
        sourceFrames[i],
        decoded.subarray(i * frameBytes, (i + 1) * frameBytes),
      );
      if (db < worstDb) worstDb = db;
    }
    check(
      `${flavor.variant} ffmpeg-decode psnr >= ${flavor.minSourceDb}`,
      worstDb >= flavor.minSourceDb,
      `${worstDb.toFixed(1)} dB`,
    );

    if (flavor.variant === 'hap-alpha') {
      const alphaDb = psnr(sourceFrames[0], decoded.subarray(0, frameBytes), 4, 3);
      check('hap-alpha alpha channel psnr >= 40', alphaDb >= 40, `${alphaDb.toFixed(1)} dB`);
    }
  }
  return firstMovPath;
}

async function testDecodeInterop(): Promise<void> {
  console.log('E. ffmpeg encode -> our decode');
  const { Input, BlobSource, EncodedPacketSink, ALL_FORMATS } = await import('mediabunny');

  for (const [ffFormat, fourCC, planeName] of [
    ['hap', 'Hap1', 'bc1'],
    ['hap_alpha', 'Hap5', 'bc3'],
    ['hap_q', 'HapY', 'ycocg-bc3'],
  ] as const) {
    const refPath = join(TMP, `ref-${ffFormat}.mov`);
    runTool('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`,
      '-frames:v', String(FRAMES),
      '-c:v', 'hap', '-format', ffFormat, '-chunks', ffFormat === 'hap' ? '4' : '1',
      refPath,
    ]);
    const refRawPath = join(TMP, `ref-${ffFormat}.raw`);
    runTool('ffmpeg', [
      '-v', 'error', '-y', '-i', refPath,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', refRawPath,
    ]);
    const ffmpegDecoded = new Uint8Array(readFileSync(refRawPath));
    const frameBytes = WIDTH * HEIGHT * 4;

    const movBytes = readFileSync(refPath);
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(new Blob([movBytes])),
    });
    try {
      const track = await input.getPrimaryVideoTrack();
      check(`${ffFormat} mediabunny codec id`, track?.internalCodecId === fourCC,
        String(track?.internalCodecId));
      if (!track) continue;
      const sink = new EncodedPacketSink(track);

      let packet = await sink.getFirstPacket();
      let frameIndex = 0;
      let worstDb = Infinity;
      while (packet && frameIndex < FRAMES) {
        const parsed = parseHapFrame(packet.data);
        const texture = parsed.textures[0];
        check(
          `${ffFormat} frame ${frameIndex} plane`,
          parsed.textures.length === 1 && texture.formatName === planeName,
          texture.formatName,
        );
        const ours = decodeTextureCpu(texture.formatName, texture.data, WIDTH, HEIGHT);
        const reference = ffmpegDecoded.subarray(frameIndex * frameBytes, (frameIndex + 1) * frameBytes);
        const db = psnrRgb(ours, reference);
        if (db < worstDb) worstDb = db;
        packet = await sink.getNextPacket(packet);
        frameIndex++;
      }
      check(`${ffFormat} decoded frame count`, frameIndex === FRAMES, String(frameIndex));
      check(
        `${ffFormat} ours-vs-ffmpeg psnr >= 45`,
        worstDb >= 45,
        `${worstDb.toFixed(1)} dB`,
      );
    } finally {
      input.dispose();
    }
  }
}

async function testOwnFileDemux(movPath: string): Promise<void> {
  console.log('F. mediabunny demux of our own .mov');
  const { Input, BlobSource, EncodedPacketSink, ALL_FORMATS } = await import('mediabunny');
  const movBytes = readFileSync(movPath);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(new Blob([movBytes])),
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    check('video track present', !!track, String(track?.internalCodecId));
    if (!track) return;
    check('codec id Hap1', track.internalCodecId === 'Hap1');
    check('dimensions', track.displayWidth === WIDTH && track.displayHeight === HEIGHT,
      `${track.displayWidth}x${track.displayHeight}`);
    const duration = await input.computeDuration();
    check('duration ~= frames/fps', Math.abs(duration - FRAMES / FPS) < 0.05, `${duration.toFixed(3)}s`);
    const sink = new EncodedPacketSink(track);
    const first = await sink.getFirstPacket();
    check('first packet decodable', !!first && parseHapFrame(first.data).textures[0].formatName === 'bc1');
    const stats = await track.computePacketStats(FRAMES);
    check('fps from packets', Math.abs(stats.averagePacketRate - FPS) < 0.5,
      stats.averagePacketRate.toFixed(2));
  } finally {
    input.dispose();
  }
}

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  testSnappy();
  testDxtCpu();
  testFrameRoundTrip();
  const ownMov = await testEncodeInterop();
  await testDecodeInterop();
  await testOwnFileDemux(ownMov);

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll HAP probe checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

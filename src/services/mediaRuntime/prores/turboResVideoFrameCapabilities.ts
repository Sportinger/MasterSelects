import type { PixelFormat } from 'turbores';
import type { TurboResProResFourCC } from './turboResCodecIdentity';

const PRORES_422_FORMAT_PREFERENCE: readonly PixelFormat[] = [
  'I422P10',
  'I422',
  'I420P10',
  'I420',
];

const PRORES_4444_FORMAT_PREFERENCE: readonly PixelFormat[] = [
  'I444AP12',
  'I444AP10',
  'I444A',
  'I422AP12',
  'I422AP10',
  'I422A',
  'I420AP12',
  'I420AP10',
  'I420A',
];

function isHighBitDepth(format: PixelFormat): boolean {
  return format.endsWith('P10') || format.endsWith('P12');
}

function hasAlpha(format: PixelFormat): boolean {
  return format.includes('A');
}

export function estimatePlanarFrameBytes(
  width: number,
  height: number,
  format: PixelFormat,
): number {
  const safeWidth = Math.max(2, Math.ceil(width));
  const safeHeight = Math.max(2, Math.ceil(height));
  const bytesPerSample = isHighBitDepth(format) ? 2 : 1;
  const lumaSamples = safeWidth * safeHeight;
  const chromaWidth = format.startsWith('I444') ? safeWidth : Math.ceil(safeWidth / 2);
  const chromaHeight = format.startsWith('I420') ? Math.ceil(safeHeight / 2) : safeHeight;
  const chromaSamples = chromaWidth * chromaHeight * 2;
  const alphaSamples = hasAlpha(format) ? lumaSamples : 0;
  return (lumaSamples + chromaSamples + alphaSamples) * bytesPerSample;
}

function canConstructVideoFrame(format: PixelFormat): boolean {
  if (typeof VideoFrame === 'undefined') return false;
  const width = 4;
  const height = 4;
  try {
    const frame = new VideoFrame(
      new Uint8Array(estimatePlanarFrameBytes(width, height, format)),
      {
        format: format as VideoPixelFormat,
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      },
    );
    frame.close();
    return true;
  } catch {
    return false;
  }
}

export function getTurboResOutputFormatCandidates(
  fourCC: TurboResProResFourCC,
): readonly PixelFormat[] {
  return fourCC === 'ap4h' || fourCC === 'ap4x'
    ? PRORES_4444_FORMAT_PREFERENCE
    : PRORES_422_FORMAT_PREFERENCE;
}

export function probeTurboResVideoFrameFormats(
  fourCC: TurboResProResFourCC,
): PixelFormat[] {
  return getTurboResOutputFormatCandidates(fourCC).filter(canConstructVideoFrame);
}

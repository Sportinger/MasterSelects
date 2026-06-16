import type { FrameFingerprint, FrameFingerprintOptions } from './frameFingerprint';
import { fingerprintRgbaPixels } from './workerFirstShadowWorkerFingerprint';
import type { WorkerFirstSolidTextImageShadowRenderPlan } from './workerFirstSolidTextImageShadowParity';

function drawMultiVideoSourceFrame(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  sampleTimeSeconds: number,
  variant: 0 | 1 | 2,
): void {
  const hue = (variant * 74 + sampleTimeSeconds * 29) % 360;
  context.clearRect(0, 0, width, height);
  const frameX = width * 0.08;
  const frameY = height * 0.15;
  const frameWidth = width * 0.74;
  const frameHeight = height * 0.58;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${hue}, 52%, ${variant === 0 ? 18 : 24}%)`);
  gradient.addColorStop(0.55, `hsl(${(hue + 32) % 360}, 62%, ${variant === 1 ? 42 : 34}%)`);
  gradient.addColorStop(1, `hsl(${(hue + 88) % 360}, 70%, ${variant === 2 ? 56 : 46}%)`);
  context.fillStyle = gradient;
  context.fillRect(frameX, frameY, frameWidth, frameHeight);

  context.fillStyle = 'rgba(255, 255, 255, 0.82)';
  context.fillRect(frameX + frameWidth * 0.08, frameY + frameHeight * 0.1, frameWidth * 0.62, frameHeight * 0.12);
  context.fillStyle = 'rgba(4, 10, 18, 0.72)';
  context.fillRect(frameX + frameWidth * 0.11, frameY + frameHeight * 0.7, frameWidth * 0.78, frameHeight * 0.16);
  context.fillStyle = variant === 0 ? '#f0c13a' : variant === 1 ? '#5fd1ff' : '#d7443e';
  context.beginPath();
  context.arc(
    frameX + frameWidth * (0.28 + variant * 0.16),
    frameY + frameHeight * 0.48,
    frameHeight * 0.16,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  context.lineWidth = Math.max(4, Math.round(width * 0.008));
  context.strokeRect(frameX, frameY, frameWidth, frameHeight);
}

export function drawMultiVideoShadowFrame(
  plan: WorkerFirstSolidTextImageShadowRenderPlan,
  options: FrameFingerprintOptions,
): FrameFingerprint {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available in the worker shadow renderer.');
  }

  const width = Math.max(1, Math.round(plan.width));
  const height = Math.max(1, Math.round(plan.height));
  const output = new OffscreenCanvas(width, height);
  const context = output.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Could not create multi-video worker shadow 2D context.');
  }

  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);

  const sources = [0, 1, 2] as const;
  const transforms = [
    { scale: 0.72, x: -0.2, y: -0.08, opacity: 1 },
    { scale: 0.48, x: 0.36, y: 0.1, opacity: 0.94 },
    { scale: 0.36, x: 0.08, y: 0.36, opacity: 0.9 },
  ] as const;
  for (const variant of sources) {
    const surface = new OffscreenCanvas(width, height);
    const surfaceContext = surface.getContext('2d');
    if (!surfaceContext) {
      throw new Error('Could not create multi-video worker shadow source surface.');
    }
    drawMultiVideoSourceFrame(surfaceContext, width, height, plan.sampleTimeSeconds, variant);
    const transform = transforms[variant];
    const drawWidth = Math.round(width * transform.scale);
    const drawHeight = Math.round(height * transform.scale);
    const drawX = Math.round((width - drawWidth) / 2 + width * transform.x);
    const drawY = Math.round((height - drawHeight) / 2 + height * transform.y);
    context.globalAlpha = transform.opacity;
    context.drawImage(surface, drawX, drawY, drawWidth, drawHeight);
  }
  context.globalAlpha = 1;

  const imageData = context.getImageData(0, 0, width, height);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width,
    height,
  }, options);
}

export function drawProviderVideoShadowFrame(
  plan: WorkerFirstSolidTextImageShadowRenderPlan,
  options: FrameFingerprintOptions,
): FrameFingerprint {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available in the worker shadow renderer.');
  }

  const width = Math.max(1, Math.round(plan.width));
  const height = Math.max(1, Math.round(plan.height));
  const output = new OffscreenCanvas(width, height);
  const context = output.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Could not create provider-video worker shadow 2D context.');
  }

  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);

  const surface = new OffscreenCanvas(width, height);
  const surfaceContext = surface.getContext('2d');
  if (!surfaceContext) {
    throw new Error('Could not create provider-video worker shadow source surface.');
  }
  drawMultiVideoSourceFrame(surfaceContext, width, height, plan.sampleTimeSeconds, 0);

  const drawWidth = Math.round(width * 0.78);
  const drawHeight = Math.round(height * 0.78);
  const drawX = Math.round((width - drawWidth) / 2 - width * 0.08);
  const drawY = Math.round((height - drawHeight) / 2 + height * 0.02);
  context.drawImage(surface, drawX, drawY, drawWidth, drawHeight);

  const imageData = context.getImageData(0, 0, width, height);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width,
    height,
  }, options);
}

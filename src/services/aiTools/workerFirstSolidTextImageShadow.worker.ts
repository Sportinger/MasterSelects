import type { FrameFingerprint, FrameFingerprintOptions } from './frameFingerprint';
import { drawMultiVideoShadowFrame, drawProviderVideoShadowFrame } from './workerFirstShadowVideoProfiles';
import { fingerprintRgbaPixels, round } from './workerFirstShadowWorkerFingerprint';
import type {
  WorkerFirstSolidTextImageShadowRenderPlan,
  WorkerFirstSolidTextImageShadowRenderResult,
} from './workerFirstSolidTextImageShadowParity';

interface WorkerShadowRequest {
  readonly plan: WorkerFirstSolidTextImageShadowRenderPlan;
  readonly options: FrameFingerprintOptions;
}

interface WorkerShadowResponse {
  readonly success: boolean;
  readonly data?: WorkerFirstSolidTextImageShadowRenderResult;
  readonly error?: string;
}

function drawFixtureImage(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.fillStyle = '#174a7c';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#f0c13a';
  context.fillRect(
    Math.round(width * 0.12),
    Math.round(height * 0.16),
    Math.round(width * 0.28),
    Math.round(height * 0.5),
  );
  context.fillStyle = '#d7443e';
  context.beginPath();
  context.arc(
    Math.round(width * 0.66),
    Math.round(height * 0.48),
    Math.round(Math.min(width, height) * 0.18),
    0,
    Math.PI * 2,
  );
  context.fill();
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(4, Math.round(width * 0.012));
  context.strokeRect(
    Math.round(width * 0.48),
    Math.round(height * 0.18),
    Math.round(width * 0.34),
    Math.round(height * 0.58),
  );
}

function drawEffectsFixtureImage(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  variant: 'outgoing' | 'incoming' | 'overlay',
): void {
  const gradient = context.createLinearGradient(0, 0, width, height);
  if (variant === 'outgoing') {
    gradient.addColorStop(0, '#24123d');
    gradient.addColorStop(1, '#d7572c');
  } else if (variant === 'incoming') {
    gradient.addColorStop(0, '#073f56');
    gradient.addColorStop(1, '#65d6b3');
  } else {
    gradient.addColorStop(0, 'rgba(255, 240, 102, 0.86)');
    gradient.addColorStop(1, 'rgba(79, 190, 255, 0.82)');
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = variant === 'overlay' ? 0.82 : 1;
  context.fillStyle = variant === 'incoming' ? '#ffffff' : '#07131f';
  context.beginPath();
  context.arc(Math.round(width * 0.3), Math.round(height * 0.45), Math.round(height * 0.22), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = variant === 'outgoing' ? '#ffffff' : '#162b52';
  context.fillRect(
    Math.round(width * 0.52),
    Math.round(height * 0.22),
    Math.round(width * 0.28),
    Math.round(height * 0.46),
  );
  context.globalAlpha = 1;

  context.strokeStyle = variant === 'overlay' ? '#051927' : '#f5f0dc';
  context.lineWidth = Math.max(5, Math.round(width * 0.008));
  context.strokeRect(
    Math.round(width * 0.1),
    Math.round(height * 0.12),
    Math.round(width * 0.8),
    Math.round(height * 0.76),
  );
}

function drawDiamondClip(
  context: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.beginPath();
  context.moveTo(x + width * 0.5, y + height * 0.08);
  context.lineTo(x + width * 0.88, y + height * 0.5);
  context.lineTo(x + width * 0.5, y + height * 0.92);
  context.lineTo(x + width * 0.12, y + height * 0.5);
  context.closePath();
}

function drawEffectsMasksTransitionsFrame(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  sampleTimeSeconds: number,
): void {
  context.fillStyle = '#080c12';
  context.fillRect(0, 0, width, height);

  const outgoing = new OffscreenCanvas(width, height);
  const outgoingContext = outgoing.getContext('2d');
  const incoming = new OffscreenCanvas(width, height);
  const incomingContext = incoming.getContext('2d');
  const overlay = new OffscreenCanvas(width, height);
  const overlayContext = overlay.getContext('2d');
  if (!outgoingContext || !incomingContext || !overlayContext) {
    throw new Error('Could not create effects/masks/transitions shadow surfaces.');
  }

  drawEffectsFixtureImage(outgoingContext, width, height, 'outgoing');
  drawEffectsFixtureImage(incomingContext, width, height, 'incoming');
  drawEffectsFixtureImage(overlayContext, width, height, 'overlay');

  const fade = Math.max(0, Math.min(1, (sampleTimeSeconds - 0.6) / 0.8));
  if (sampleTimeSeconds < 1.1) {
    context.globalAlpha = 1 - fade;
    context.drawImage(outgoing, 0, 0);
  }
  if (sampleTimeSeconds >= 0.4) {
    context.globalAlpha = Math.max(fade, sampleTimeSeconds >= 1 ? 1 : 0.18);
    context.drawImage(incoming, 0, 0);
  }
  context.globalAlpha = 1;

  const overlayWidth = Math.round(width * 0.72);
  const overlayHeight = Math.round(height * 0.72);
  const overlayX = Math.round((width - overlayWidth) / 2 + width * 0.04);
  const overlayY = Math.round((height - overlayHeight) / 2 + height * 0.02);
  context.save();
  drawDiamondClip(context, overlayX, overlayY, overlayWidth, overlayHeight);
  context.clip();
  context.globalAlpha = 0.78;
  context.globalCompositeOperation = 'screen';
  context.filter = 'saturate(1.35) brightness(1.12)';
  context.drawImage(overlay, overlayX, overlayY, overlayWidth, overlayHeight);
  context.restore();
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  context.globalAlpha = 1;
}

function drawJpegProxyDiagnosticImage(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  frameIndex: number,
): void {
  const hue = (frameIndex * 17) % 360;
  context.fillStyle = frameIndex === 0 ? '#000000' : `hsl(${hue}, 72%, 38%)`;
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(255, 255, 255, 0.92)';
  context.fillRect(width * 0.12, height * 0.16, width * 0.76, height * 0.2);
  context.fillStyle = '#07111f';
  context.fillRect(width * 0.18, height * 0.48, width * 0.64, height * 0.24);
  context.fillStyle = '#ffd24a';
  context.beginPath();
  context.arc(width * 0.32, height * 0.6, height * 0.09, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#5fd1ff';
  context.fillRect(width * 0.48, height * 0.52, width * 0.18, height * 0.16);
  context.fillStyle = '#ffffff';
  context.font = `${Math.round(height * 0.09)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`JPEG PROXY ${frameIndex}`, width / 2, height * 0.26);
}

function drawNestedFixtureImage(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  variant: 'child-base' | 'child-accent' | 'parent-overlay',
): void {
  const palette = {
    navy: '#101b35',
    blue: '#1f5e96',
    cyan: '#57c4e5',
    red: '#d64d47',
    green: '#6abd63',
    yellow: '#f4c84a',
    white: '#f6f7fb',
  };

  context.clearRect(0, 0, width, height);
  context.fillStyle = variant === 'parent-overlay' ? palette.navy : palette.blue;
  context.fillRect(0, 0, width, height);

  if (variant === 'child-base') {
    context.fillStyle = palette.yellow;
    context.fillRect(Math.round(width * 0.08), Math.round(height * 0.16), Math.round(width * 0.34), Math.round(height * 0.58));
    context.fillStyle = palette.red;
    context.beginPath();
    context.arc(Math.round(width * 0.68), Math.round(height * 0.45), Math.round(Math.min(width, height) * 0.2), 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.white;
    context.lineWidth = Math.max(3, Math.round(width * 0.015));
    context.strokeRect(Math.round(width * 0.52), Math.round(height * 0.18), Math.round(width * 0.32), Math.round(height * 0.55));
    return;
  }

  if (variant === 'child-accent') {
    context.fillStyle = palette.green;
    context.fillRect(Math.round(width * 0.18), Math.round(height * 0.18), Math.round(width * 0.28), Math.round(height * 0.52));
    context.fillStyle = palette.cyan;
    context.beginPath();
    context.moveTo(Math.round(width * 0.6), Math.round(height * 0.18));
    context.lineTo(Math.round(width * 0.86), Math.round(height * 0.72));
    context.lineTo(Math.round(width * 0.36), Math.round(height * 0.72));
    context.closePath();
    context.fill();
    return;
  }

  context.fillStyle = 'rgba(246, 247, 251, 0.88)';
  context.fillRect(Math.round(width * 0.06), Math.round(height * 0.08), Math.round(width * 0.88), Math.round(height * 0.12));
  context.fillStyle = palette.cyan;
  context.fillRect(Math.round(width * 0.12), Math.round(height * 0.76), Math.round(width * 0.76), Math.round(height * 0.12));
  context.fillStyle = palette.red;
  context.beginPath();
  context.arc(Math.round(width * 0.2), Math.round(height * 0.34), Math.round(Math.min(width, height) * 0.09), 0, Math.PI * 2);
  context.fill();
}

function drawCenteredText(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const fontSize = Math.round(Math.max(48, Math.min(width, height) * 0.1));
  const lines = ['Worker First', 'Golden'];
  const lineHeight = fontSize * 1.2;
  const startY = Math.round(height * 0.11 + (height * 0.3 - lineHeight * lines.length) / 2 + fontSize * 0.82);
  context.save();
  context.font = `700 ${fontSize}px Roboto, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = 10;
  context.shadowOffsetX = 5;
  context.shadowOffsetY = 5;
  context.lineJoin = 'round';
  context.strokeStyle = '#0a0f1f';
  context.lineWidth = 5;
  context.fillStyle = '#ffffff';
  for (let index = 0; index < lines.length; index += 1) {
    const y = startY + index * lineHeight;
    context.strokeText(lines[index], width / 2, y);
    context.fillText(lines[index], width / 2, y);
  }
  context.restore();
}

function drawShadowFrame(
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
    throw new Error('Could not create worker shadow 2D context.');
  }

  context.fillStyle = '#13233f';
  context.fillRect(0, 0, width, height);

  const image = new OffscreenCanvas(width, height);
  const imageContext = image.getContext('2d');
  if (!imageContext) {
    throw new Error('Could not create worker shadow image context.');
  }

  drawFixtureImage(imageContext, width, height);
  const drawWidth = Math.round(width * 0.58);
  const drawHeight = Math.round(height * 0.58);
  const drawX = Math.round((width - drawWidth) / 2);
  const drawY = Math.round(height * 0.205);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  drawCenteredText(context, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width,
    height,
  }, options);
}

function drawRamCacheShadowFrame(
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
    throw new Error('Could not create ram-cache worker shadow 2D context.');
  }

  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);

  const drawWidth = Math.round(width * 0.375);
  const gradient = context.createLinearGradient(0, 0, drawWidth, height);
  gradient.addColorStop(0, '#1c2a39');
  gradient.addColorStop(0.55, '#3e617b');
  gradient.addColorStop(1, '#68a4c9');
  context.fillStyle = gradient;
  context.fillRect(0, 0, drawWidth, height);

  context.fillStyle = '#f0c13a';
  context.fillRect(Math.round(drawWidth * 0.18), Math.round(height * 0.18), Math.round(drawWidth * 0.28), Math.round(height * 0.36));
  context.fillStyle = '#d7443e';
  context.beginPath();
  context.arc(Math.round(drawWidth * 0.7), Math.round(height * 0.46), Math.round(Math.min(drawWidth, height) * 0.14), 0, Math.PI * 2);
  context.fill();

  const imageData = context.getImageData(0, 0, width, height);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width,
    height,
  }, options);
}

function drawJpegProxyShadowFrame(
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
    throw new Error('Could not create worker shadow 2D context.');
  }

  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);

  const proxy = new OffscreenCanvas(640, 360);
  const proxyContext = proxy.getContext('2d');
  if (!proxyContext) {
    throw new Error('Could not create jpeg-proxy worker shadow image context.');
  }

  drawJpegProxyDiagnosticImage(proxyContext, 640, 360, Math.floor(plan.sampleTimeSeconds * 24));
  const drawWidth = Math.round(width * 0.78);
  const drawHeight = Math.round(height * 0.78);
  const drawX = Math.round((width - drawWidth) / 2 - width * 0.08);
  const drawY = Math.round((height - drawHeight) / 2 + height * 0.02);
  context.drawImage(proxy, drawX, drawY, drawWidth, drawHeight);

  const imageData = context.getImageData(0, 0, width, height);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width,
    height,
  }, options);
}

function drawCanvasTransformed(
  context: OffscreenCanvasRenderingContext2D,
  source: OffscreenCanvas,
  outputWidth: number,
  outputHeight: number,
  scale: number,
  positionX: number,
  positionY: number,
  opacity = 1,
): void {
  const drawWidth = Math.round(outputWidth * scale);
  const drawHeight = Math.round(outputHeight * scale);
  const drawX = Math.round((outputWidth - drawWidth) / 2 + outputWidth * positionX);
  const drawY = Math.round((outputHeight - drawHeight) / 2 + outputHeight * positionY);
  context.save();
  context.globalAlpha = opacity;
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  context.restore();
}

function createNestedChildSurface(width: number, height: number): OffscreenCanvas {
  const child = new OffscreenCanvas(width, height);
  const context = child.getContext('2d');
  if (!context) {
    throw new Error('Could not create nested child worker shadow context.');
  }
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, width, height);

  const base = new OffscreenCanvas(720, 405);
  const baseContext = base.getContext('2d');
  const accent = new OffscreenCanvas(720, 405);
  const accentContext = accent.getContext('2d');
  if (!baseContext || !accentContext) {
    throw new Error('Could not create nested child source surfaces.');
  }
  drawNestedFixtureImage(baseContext, 720, 405, 'child-base');
  drawNestedFixtureImage(accentContext, 720, 405, 'child-accent');
  drawCanvasTransformed(context, base, width, height, 0.86, -0.12, -0.04);
  drawCanvasTransformed(context, accent, width, height, 0.7, 0.22, 0.08, 0.86);
  return child;
}

function createNestedParentSurface(width: number, height: number): OffscreenCanvas {
  const parent = new OffscreenCanvas(width, height);
  const context = parent.getContext('2d');
  if (!context) {
    throw new Error('Could not create nested parent worker shadow context.');
  }
  context.fillStyle = '#111827';
  context.fillRect(0, 0, width, height);

  const child = createNestedChildSurface(width, height);
  const overlay = new OffscreenCanvas(720, 405);
  const overlayContext = overlay.getContext('2d');
  if (!overlayContext) {
    throw new Error('Could not create nested parent overlay surface.');
  }
  drawNestedFixtureImage(overlayContext, 720, 405, 'parent-overlay');
  drawCanvasTransformed(context, child, width, height, 0.74, -0.08, 0.06);
  drawCanvasTransformed(context, overlay, width, height, 0.96, 0, 0, 0.72);
  return parent;
}

function drawNestedCompsShadowFrame(
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
    throw new Error('Could not create worker shadow 2D context.');
  }

  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);
  const parent = createNestedParentSurface(width, height);
  const child = createNestedChildSurface(width, height);
  drawCanvasTransformed(context, parent, width, height, 0.615, -0.18, 0.04);
  if (plan.sampleTimeSeconds >= 0.55) {
    drawCanvasTransformed(context, parent, width, height, 0.465, 0.22, -0.12, 0.78);
  }
  if (plan.sampleTimeSeconds >= 1.15 && plan.sampleTimeSeconds <= 2) {
    drawCanvasTransformed(context, child, width, height, 0.34875, 0.34, 0.26, 0.84);
  }

  const imageData = context.getImageData(0, 0, width, height);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width,
    height,
  }, options);
}

function drawEffectsMasksTransitionsShadowFrame(
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
    throw new Error('Could not create worker shadow 2D context.');
  }

  drawEffectsMasksTransitionsFrame(context, width, height, plan.sampleTimeSeconds);
  const imageData = context.getImageData(0, 0, width, height);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width,
    height,
  }, options);
}

function rendererNameForPlan(
  plan: WorkerFirstSolidTextImageShadowRenderPlan,
): WorkerFirstSolidTextImageShadowRenderResult['renderer'] {
  if (plan.projectId === 'effects-masks-transitions') {
    return 'worker-offscreen-2d-effects-masks-transitions';
  }
  if (plan.projectId === 'multi-video') {
    return 'worker-offscreen-2d-multi-video';
  }
  if (plan.projectId === 'webcodecs-provider') {
    return 'worker-offscreen-2d-webcodecs-provider';
  }
  if (plan.projectId === 'html-provider-fallback') {
    return 'worker-offscreen-2d-html-provider-fallback';
  }
  if (plan.projectId === 'jpeg-proxy') {
    return 'worker-offscreen-2d-jpeg-proxy';
  }
  if (plan.projectId === 'nested-comps') {
    return 'worker-offscreen-2d-nested-comps';
  }
  if (plan.projectId === 'ram-cache') {
    return 'worker-offscreen-2d-ram-cache';
  }
  if (plan.projectId === 'bake') {
    return 'worker-offscreen-2d-bake';
  }
  if (plan.projectId === 'export') {
    return 'worker-offscreen-2d-export';
  }
  if (plan.projectId === 'universal-3d-gaussian-cad') {
    return 'worker-offscreen-2d-universal-3d-gaussian-cad';
  }
  return plan.projectId === 'multi-target-output-slice'
    ? 'worker-offscreen-2d-multi-target-output-slice'
    : 'worker-offscreen-2d-solid-text-image';
}

function drawFingerprintForPlan(
  plan: WorkerFirstSolidTextImageShadowRenderPlan,
  options: FrameFingerprintOptions,
): FrameFingerprint {
  if (plan.projectId === 'effects-masks-transitions') {
    return drawEffectsMasksTransitionsShadowFrame(plan, options);
  }
  if (plan.projectId === 'multi-video') {
    return drawMultiVideoShadowFrame(plan, options);
  }
  if (plan.projectId === 'webcodecs-provider') {
    return drawProviderVideoShadowFrame(plan, options);
  }
  if (plan.projectId === 'html-provider-fallback') {
    return drawProviderVideoShadowFrame(plan, options);
  }
  if (plan.projectId === 'jpeg-proxy') {
    return drawJpegProxyShadowFrame(plan, options);
  }
  if (plan.projectId === 'nested-comps') {
    return drawNestedCompsShadowFrame(plan, options);
  }
  if (plan.projectId === 'ram-cache') {
    return drawRamCacheShadowFrame(plan, options);
  }
  if (plan.projectId === 'bake') {
    return drawRamCacheShadowFrame(plan, options);
  }
  return drawShadowFrame(plan, options);
}

self.onmessage = (event: MessageEvent<WorkerShadowRequest>) => {
  const startedAt = performance.now();
  const response: WorkerShadowResponse = (() => {
    try {
      return {
        success: true,
        data: {
          renderer: rendererNameForPlan(event.data.plan),
          fingerprint: drawFingerprintForPlan(event.data.plan, event.data.options),
          workerMs: round(performance.now() - startedAt),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  self.postMessage(response);
};

export {};

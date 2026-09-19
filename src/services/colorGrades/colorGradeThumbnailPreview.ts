import {
  getPrimaryRuntimeParams,
  isNeutralPrimaryParams,
  type ColorNode,
  type RuntimeColorGrade,
  type RuntimePrimaryColorParams,
} from '../../types/colorCorrection';
import {
  areRuntimeColorCurvesNeutral,
  getRuntimeColorCurves,
  type RuntimeColorCurves,
} from '../../types/colorCurves';

const PREVIEW_WIDTH = 128;
const PREVIEW_HEIGHT = 72;
const MAX_SOURCE_CACHE_ENTRIES = 48;
const MAX_RENDER_CACHE_ENTRIES = 128;

export interface ColorGradeThumbnailPreview {
  graphHash: string;
  primaryNodes: RuntimePrimaryColorParams[];
  curvesByNode: RuntimeColorCurves[];
}

export interface ColorGradePreviewNode {
  id: string;
  type: string;
  enabled?: boolean;
  params: Record<string, unknown>;
}

export function toColorGradeThumbnailPreview(
  grade: RuntimeColorGrade | undefined,
): ColorGradeThumbnailPreview | undefined {
  if (!grade?.enabled || grade.primaryNodes.length === 0) return undefined;
  return {
    graphHash: grade.graphHash,
    primaryNodes: grade.primaryNodes,
    curvesByNode: grade.curvesByNode ?? [],
  };
}

export function createNodeColorGradeThumbnailPreview(
  nodes: readonly ColorGradePreviewNode[],
  throughNodeId: string,
): ColorGradeThumbnailPreview | undefined {
  const primaryNodes: RuntimePrimaryColorParams[] = [];
  const curvesByNode: RuntimeColorCurves[] = [];

  for (const node of nodes) {
    const isGradeNode = node.type === 'primary' || node.type === 'wheels';
    if (isGradeNode && node.enabled !== false) {
      const colorNode: ColorNode = {
        id: node.id,
        type: node.type as ColorNode['type'],
        name: node.id,
        enabled: true,
        params: node.params as ColorNode['params'],
        position: { x: 0, y: 0 },
      };
      const params = getPrimaryRuntimeParams(colorNode);
      const curves = getRuntimeColorCurves(node.params);
      if (!isNeutralPrimaryParams(params) || !areRuntimeColorCurvesNeutral(curves)) {
        primaryNodes.push(params);
        curvesByNode.push(curves);
      }
    }
    if (node.id === throughNodeId) break;
  }

  if (primaryNodes.length === 0) return undefined;
  return {
    graphHash: JSON.stringify({ throughNodeId, primaryNodes, curvesByNode }),
    primaryNodes,
    curvesByNode,
  };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function luma(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function sampleCurve(samples: number[] | undefined, value: number): number {
  if (!samples || samples.length < 2) return clampUnit(value);
  const scaled = clampUnit(value) * (samples.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(samples.length - 1, lower + 1);
  const mix = scaled - lower;
  return samples[lower] * (1 - mix) + samples[upper] * mix;
}

function hueRotate(
  red: number,
  green: number,
  blue: number,
  degrees: number,
): [number, number, number] {
  const angle = degrees * Math.PI / 180;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const y = red * 0.299 + green * 0.587 + blue * 0.114;
  const inPhase = red * 0.596 - green * 0.274 - blue * 0.322;
  const quadrature = red * 0.211 - green * 0.523 + blue * 0.312;
  const rotatedI = inPhase * cosine - quadrature * sine;
  const rotatedQ = inPhase * sine + quadrature * cosine;
  return [
    y + 0.956 * rotatedI + 0.621 * rotatedQ,
    y - 0.272 * rotatedI - 0.647 * rotatedQ,
    y - 1.106 * rotatedI + 1.703 * rotatedQ,
  ];
}

function applyPrimaryNode(
  rgb: [number, number, number],
  params: RuntimePrimaryColorParams,
  curves: RuntimeColorCurves | undefined,
): [number, number, number] {
  const range = Math.max(params.whitePoint - params.blackPoint, 0.001);
  let red = clampUnit((rgb[0] - params.blackPoint) / range);
  let green = clampUnit((rgb[1] - params.blackPoint) / range);
  let blue = clampUnit((rgb[2] - params.blackPoint) / range);

  const sharedLift = params.lift + params.offset + params.liftY + params.offsetY;
  red += sharedLift + params.liftR + params.offsetR;
  green += sharedLift + params.liftG + params.offsetG;
  blue += sharedLift + params.liftB + params.offsetB;

  const exposure = 2 ** params.exposure;
  red *= exposure;
  green *= exposure;
  blue *= exposure;

  const toneY = luma(red, green, blue);
  const shadowMask = clampUnit(1 - toneY * 2);
  const highlightMask = clampUnit(toneY * 2 - 1);
  const toneOffset = params.shadows * 0.35 * shadowMask
    + params.highlights * 0.35 * highlightMask;
  red += toneOffset;
  green += toneOffset;
  blue += toneOffset;

  const gammaShared = Math.max(0.001, params.gamma * params.gammaY);
  red = Math.max(0, red) ** (1 / Math.max(0.001, gammaShared * params.gammaR));
  green = Math.max(0, green) ** (1 / Math.max(0.001, gammaShared * params.gammaG));
  blue = Math.max(0, blue) ** (1 / Math.max(0.001, gammaShared * params.gammaB));

  const gainShared = params.gain * params.gainY;
  red *= gainShared * params.gainR;
  green *= gainShared * params.gainG;
  blue *= gainShared * params.gainB;

  red = (red - params.pivot) * params.contrast + params.pivot;
  green = (green - params.pivot) * params.contrast + params.pivot;
  blue = (blue - params.pivot) * params.contrast + params.pivot;

  let y = luma(red, green, blue);
  red = y + (red - y) * params.saturation;
  green = y + (green - y) * params.saturation;
  blue = y + (blue - y) * params.saturation;

  y = luma(red, green, blue);
  const chroma = Math.hypot(red - y, green - y, blue - y);
  const vibrance = 1 + params.vibrance * clampUnit(1 - chroma * 1.8);
  red = y + (red - y) * vibrance;
  green = y + (green - y) * vibrance;
  blue = y + (blue - y) * vibrance;

  [red, green, blue] = hueRotate(red, green, blue, params.hue);
  red += params.temperature * 0.08;
  green += params.tint * 0.05;
  blue -= params.temperature * 0.08;

  red = sampleCurve(curves?.y, red);
  green = sampleCurve(curves?.y, green);
  blue = sampleCurve(curves?.y, blue);
  return [
    sampleCurve(curves?.r, red),
    sampleCurve(curves?.g, green),
    sampleCurve(curves?.b, blue),
  ];
}

export function applyColorGradeThumbnailPreview(
  pixels: Uint8ClampedArray,
  preview: ColorGradeThumbnailPreview,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(pixels);
  for (let index = 0; index < output.length; index += 4) {
    let rgb: [number, number, number] = [
      output[index] / 255,
      output[index + 1] / 255,
      output[index + 2] / 255,
    ];
    preview.primaryNodes.forEach((params, nodeIndex) => {
      rgb = applyPrimaryNode(rgb, params, preview.curvesByNode[nodeIndex]);
    });
    output[index] = Math.round(clampUnit(rgb[0]) * 255);
    output[index + 1] = Math.round(clampUnit(rgb[1]) * 255);
    output[index + 2] = Math.round(clampUnit(rgb[2]) * 255);
  }
  return output;
}

function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Color thumbnail source could not be decoded.'));
    image.src = sourceUrl;
  });
}

function trimCache<K, V>(cache: Map<K, V>, maximum: number): void {
  while (cache.size > maximum) {
    const oldestKey = cache.keys().next().value as K | undefined;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

class ColorGradeThumbnailPreviewRenderer {
  private readonly sourceCache = new Map<string, Promise<ImageData>>();
  private readonly renderCache = new Map<string, Promise<string>>();

  async render(sourceUrl: string, preview: ColorGradeThumbnailPreview): Promise<string> {
    const cacheKey = `${sourceUrl}\u0000${preview.graphHash}`;
    const cached = this.renderCache.get(cacheKey);
    if (cached) return cached;

    const rendered = this.renderPreview(sourceUrl, preview).catch(() => sourceUrl);
    this.renderCache.set(cacheKey, rendered);
    trimCache(this.renderCache, MAX_RENDER_CACHE_ENTRIES);
    return rendered;
  }

  private getSourcePixels(sourceUrl: string): Promise<ImageData> {
    const cached = this.sourceCache.get(sourceUrl);
    if (cached) return cached;

    const loaded = loadImage(sourceUrl).then(image => {
      const canvas = document.createElement('canvas');
      canvas.width = PREVIEW_WIDTH;
      canvas.height = PREVIEW_HEIGHT;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Color thumbnail canvas is unavailable.');

      const scale = Math.max(PREVIEW_WIDTH / image.naturalWidth, PREVIEW_HEIGHT / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(
        image,
        (PREVIEW_WIDTH - width) / 2,
        (PREVIEW_HEIGHT - height) / 2,
        width,
        height,
      );
      return context.getImageData(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    });
    this.sourceCache.set(sourceUrl, loaded);
    trimCache(this.sourceCache, MAX_SOURCE_CACHE_ENTRIES);
    return loaded;
  }

  private async renderPreview(
    sourceUrl: string,
    preview: ColorGradeThumbnailPreview,
  ): Promise<string> {
    const source = await this.getSourcePixels(sourceUrl);
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) return sourceUrl;
    const output = applyColorGradeThumbnailPreview(source.data, preview);
    const outputImage = context.createImageData(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    outputImage.data.set(output);
    context.putImageData(outputImage, 0, 0);
    return canvas.toDataURL('image/webp', 0.82);
  }
}

type ThumbnailPreviewHotData = {
  renderer?: ColorGradeThumbnailPreviewRenderer;
};

const hotData = import.meta.hot?.data as ThumbnailPreviewHotData | undefined;
export const colorGradeThumbnailPreviewRenderer = hotData?.renderer
  ?? new ColorGradeThumbnailPreviewRenderer();

if (import.meta.hot) {
  import.meta.hot.dispose((data: ThumbnailPreviewHotData) => {
    data.renderer = colorGradeThumbnailPreviewRenderer;
  });
}

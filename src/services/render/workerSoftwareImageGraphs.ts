import type { ImageOperatorPlan } from '../operators/imageOperatorGraph';
import { createImageOperatorEvaluator } from '../operators/imageOperatorEvaluation';
import { glyphAtlasCacheKey } from '../../effects/_shared/glyphAtlasPlan';
import { rasterizeGlyphAtlas } from '../../effects/_shared/glyphAtlasRaster';
import { IMAGE_FRAME_HISTORY_RESOURCE_ID } from '../operators/imageOperatorResources';
import type { FrameHistoryLoopPolicy } from '../../effects/frameHistoryTransition';
import type { WorkerSoftwareFeedbackStore, WorkerSoftwareFeedbackFrameMetadata } from './workerSoftwareFeedbackEffects';

export interface WorkerSoftwareImageGraphOwner {
  readonly feedbackKey: string;
  readonly reset: boolean;
  readonly historyLoop: FrameHistoryLoopPolicy;
}
interface SoftwareImageGraphExecution {
  readonly owners?: readonly WorkerSoftwareImageGraphOwner[];
  readonly store?: WorkerSoftwareFeedbackStore;
  readonly scopeId: string;
  readonly frame: WorkerSoftwareFeedbackFrameMetadata;
}

type Pixel = [number, number, number, number];
interface SoftwareExternalResource { readonly width: number; readonly height: number; readonly pixels: Uint8ClampedArray }
const GLYPH_ATLAS_CACHE_LIMIT = 16;
const glyphAtlasPixels = new Map<string, SoftwareExternalResource>();
type GlyphExternalResource = Extract<NonNullable<ImageOperatorPlan['externalResources']>[number], { kind: 'glyph-atlas' }>;
type GlyphAtlasOptions = GlyphExternalResource['options'];

export function clearWorkerSoftwareGlyphAtlasCache(): void { glyphAtlasPixels.clear(); }

function glyphDescriptors(plan: ImageOperatorPlan): Map<string, { key: string; options: GlyphAtlasOptions }> {
  const descriptors = new Map<string, { key: string; options: GlyphAtlasOptions }>();
  for (const descriptor of plan.externalResources ?? []) {
    if (descriptor.kind !== 'glyph-atlas') throw new Error(`Software image graph does not support external resource kind ${String((descriptor as { kind?: unknown }).kind)}.`);
    const key = glyphAtlasCacheKey(descriptor.options), previous = descriptors.get(descriptor.id);
    if (previous && previous.key !== key) throw new Error(`Software image graph resource ${descriptor.id} has conflicting descriptors.`);
    descriptors.set(descriptor.id, { key, options: descriptor.options });
  }
  return descriptors;
}

/** Admission predicate shared with software effect planning. */
export function canApplyWorkerSoftwareImageGraphPlan(plan: ImageOperatorPlan): boolean {
  if (plan.passes?.length) return false;
  if (plan.frameHistoryResource && plan.frameHistoryResource !== IMAGE_FRAME_HISTORY_RESOURCE_ID) return false;
  try {
    const descriptors = glyphDescriptors(plan);
    return (plan.resourceInputs ?? []).every((id, index) => (descriptors.has(id) || id === plan.frameHistoryResource)
      && (plan.resourceSampling?.[index] ?? 'hardware-linear-clamp') === 'hardware-linear-clamp');
  } catch { return false; }
}

function glyphAtlasResource(key: string, options: GlyphAtlasOptions): SoftwareExternalResource {
  const cached = glyphAtlasPixels.get(key);
  if (cached) { glyphAtlasPixels.delete(key); glyphAtlasPixels.set(key, cached); return cached; }
  const { canvas, plan } = rasterizeGlyphAtlas(options);
  const context = canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Software glyph atlas requires a readable 2D canvas.');
  const resource = { width: plan.width, height: plan.height,
    pixels: new Uint8ClampedArray(context.getImageData(0, 0, plan.width, plan.height).data) };
  glyphAtlasPixels.set(key, resource);
  while (glyphAtlasPixels.size > GLYPH_ATLAS_CACHE_LIMIT) glyphAtlasPixels.delete(glyphAtlasPixels.keys().next().value!);
  return resource;
}

function prepareExternalResources(plan: ImageOperatorPlan): ReadonlyMap<string, SoftwareExternalResource> {
  if (plan.passes?.length) throw new Error('Software image graphs do not yet support materialized passes.');
  const descriptors = glyphDescriptors(plan), resources = new Map<string, SoftwareExternalResource>();
  for (const [index, id] of (plan.resourceInputs ?? []).entries()) {
    if ((plan.resourceSampling?.[index] ?? 'hardware-linear-clamp') !== 'hardware-linear-clamp') {
      throw new Error(`Software image resource ${id} requires hardware-linear-clamp sampling.`);
    }
    if (id === plan.frameHistoryResource && id === IMAGE_FRAME_HISTORY_RESOURCE_ID) continue;
    const descriptor = descriptors.get(id);
    if (!descriptor) throw new Error(`Software image graph resource ${id} has no glyph-atlas descriptor.`);
    resources.set(id, glyphAtlasResource(descriptor.key, descriptor.options));
  }
  return resources;
}

function snapshotSampler(data: Uint8ClampedArray, width: number, height: number) {
  const pixel = snapshotPixelLoader(data, width, height);
  return ([u, v]: [number, number]): Pixel => {
    const px = u * width - .5, py = v * height - .5;
    const x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0;
    const a = pixel([x0, y0]), b = pixel([x0 + 1, y0]), c = pixel([x0, y0 + 1]), d = pixel([x0 + 1, y0 + 1]);
    return a.map((value, channel) => {
      const top = value + (b[channel] - value) * tx;
      const bottom = c[channel] + (d[channel] - c[channel]) * tx;
      return top + (bottom - top) * ty;
    }) as Pixel;
  };
}

function snapshotPixelLoader(data: Uint8ClampedArray, width: number, height: number) {
  return ([x, y]: [number, number]): Pixel => {
    const column = Math.max(0, Math.min(width - 1, Math.trunc(x))), row = Math.max(0, Math.min(height - 1, Math.trunc(y)));
    const offset = (row * width + column) * 4;
    return [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, data[offset + 3] / 255];
  };
}

const toByte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);

/** Applies canonical single-pass image programs to a straight-alpha RGBA8 raster. */
export function applyWorkerSoftwareImageGraphs(data: Uint8ClampedArray, width: number, height: number,
  programs: readonly ImageOperatorPlan[], timelineTime: number, execution?: SoftwareImageGraphExecution): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || data.length !== width * height * 4) {
    throw new Error('Software image graph raster dimensions do not match its RGBA data.');
  }
  if (!Number.isFinite(timelineTime)) throw new Error('Software image graph timeline time must be finite.');
  const prepared = programs.map((plan, index) => {
    const owner = execution?.owners?.[index];
    if (plan.frameHistoryResource && (!execution?.store || !owner?.feedbackKey
      || plan.frameHistoryResource !== IMAGE_FRAME_HISTORY_RESOURCE_ID)) {
      throw new Error('Software history graph requires an explicit effect owner and feedback store.');
    }
    return { plan, owner, resources: prepareExternalResources(plan) };
  });
  for (const { plan, owner, resources } of prepared) {
    const input = data.slice(), sampleImage = snapshotSampler(input, width, height), loadImage = snapshotPixelLoader(input, width, height);
    const evaluate = createImageOperatorEvaluator(plan);
    const samplers = new Map([...resources].map(([id, resource]) => [id, snapshotSampler(resource.pixels, resource.width, resource.height)]));
    const loaders = new Map([...resources].map(([id, resource]) => [id, snapshotPixelLoader(resource.pixels, resource.width, resource.height)]));
    const historyInput = plan.frameHistoryResource ? {
      scopeId: execution!.scopeId, feedbackKey: owner!.feedbackKey, width, height,
      reset: owner!.reset, loopPolicy: owner!.historyLoop,
      frame: { ...execution!.frame, ownerRevision: JSON.stringify([execution!.frame.ownerRevision ?? 0, plan.key]) },
    } : undefined;
    if (historyInput) {
      const history = execution!.store!.read(historyInput);
      samplers.set(plan.frameHistoryResource!, history ? snapshotSampler(history, width, height) : () => [0, 0, 0, 0]);
      loaders.set(plan.frameHistoryResource!, history ? snapshotPixelLoader(history, width, height) : () => [0, 0, 0, 0]);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const pixel: Pixel = [input[offset] / 255, input[offset + 1] / 255, input[offset + 2] / 255, input[offset + 3] / 255];
      const output = evaluate(pixel, {
        uv: [(x + .5) / width, (y + .5) / height], resolution: [width, height], timelineTimeSeconds: timelineTime, sampleImage,
        sampleResource: (id, uv) => samplers.get(id)!(uv),
        loadImage, loadResource: (id, pixel) => loaders.get(id)!(pixel),
        pixelCoordinate: [x, y], derivativeAutoMode: 'coarse',
      });
      data[offset] = toByte(output[0]); data[offset + 1] = toByte(output[1]);
      data[offset + 2] = toByte(output[2]); data[offset + 3] = toByte(output[3]);
    }
    if (historyInput) execution!.store!.write({ ...historyInput, pixels: data.slice() });
  }
}

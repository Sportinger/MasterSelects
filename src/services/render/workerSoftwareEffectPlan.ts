import type { BlendMode, Layer } from '../../types';
import type { RuntimePrimaryColorParams } from '../../types/colorCorrection';
import type { Effect } from '../../types/effects';
import type { WorkerRenderSoftwarePixelEffects } from './workerRenderHostRuntimeCommands';
import type { ImageOperatorPlan } from '../operators/imageOperatorGraph';
import { prepareImageEffect } from '../operators/imageEffectRuntimePlan';
import { effectOperatorParams, isImageGraphEffectType } from '../operators/effectGraphOwner';
import { rendersBuiltInMirrorPixelRecipe } from '../operators/mirrorPixelGraphUpgrade';
import { resolveFeedbackHistoryLoop } from '../../effects/_shared/feedbackParameters';
import { canApplyWorkerSoftwareImageGraphPlan } from './workerSoftwareImageGraphs';
import { GAUSSIAN_SIGMA_PER_RADIUS, blurPixelScale, radialBlurMode } from '../../effects/blur/blurSampling';
import { workerSoftwareUvDistortAdjustment, type WorkerSoftwareUvDistortAdjustment } from './workerSoftwareUvDistortEffects';
import { workerSoftwareMirrorPixelAdjustment, type WorkerSoftwareMirrorPixelAdjustment } from './workerSoftwareMirrorPixelEffects';

/** Built-in recipes with a hand-written worker CPU pass (edited graphs run through the graph interpreter). */
const HAND_WRITTEN_MIRROR_PIXEL = new Set(['kaleidoscope', 'mirror', 'pixelate', 'rgb-split']);

const CANVAS_COMPOSITE_BY_BLEND_MODE: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  add: 'lighter',
  'linear-dodge': 'lighter',
  'alpha-add': 'lighter',
};

export interface WorkerSoftwareEffectPlan {
  readonly filter: string;
  readonly pixelEffects: WorkerRenderSoftwarePixelEffects;
}

interface MutableWorkerSoftwarePixelEffects {
  brightness: number;
  imageOperatorPlans?: ImageOperatorPlan[];
  imageOperatorPlanOwners?: import('./workerSoftwareImageGraphs').WorkerSoftwareImageGraphOwner[];
  acuarelaAdjustments?: {
    feedbackKey: string;
    opacity: number;
    gain: number;
    speed: number;
    detail: number;
    strength: number;
    density: number;
    gainX: number;
    gainY: number;
    reset: boolean;
    historyLoop?: 'reset' | 'continuous';
  }[];
  rom1Adjustments?: {
    feedbackKey: string;
    opacity: number;
    gain: number;
    speed: number;
    detail: number;
    strength: number;
    density: number;
    gainX: number;
    gainY: number;
    reset: boolean;
    historyLoop?: 'reset' | 'continuous';
  }[];
  /** Built-in Kaleidoscope, Mirror, RGB Split and Pixelate, in stack order. */
  mirrorPixelAdjustments?: WorkerSoftwareMirrorPixelAdjustment[];
  exposureAdjustments?: { exposure: number; offset: number; gamma: number }[];
  temperatureAdjustments?: { temperature: number; tint: number }[];
  vibranceAdjustments?: { amount: number }[];
  levelsAdjustments?: {
    inputBlack: number;
    inputWhite: number;
    gamma: number;
    outputBlack: number;
    outputWhite: number;
  }[];
  thresholdAdjustments?: { level: number }[];
  posterizeAdjustments?: { levels: number }[];
  vignetteAdjustments?: { amount: number; size: number; softness: number; roundness: number }[];
  chromaKeyAdjustments?: {
    keyColor: 'green' | 'blue';
    tolerance: number;
    softness: number;
    spillSuppression: number;
  }[];
  edgeDetectAdjustments?: { strength: number; invert: boolean }[];
  sharpenAdjustments?: { amount: number; radius: number }[];
  glowAdjustments?: {
    amount: number;
    threshold: number;
    radius: number;
    softness: number;
    rings: number;
    samplesPerRing: number;
  }[];
  scanlineAdjustments?: { density: number; opacity: number; speed: number }[];
  grainAdjustments?: { amount: number; size: number; speed: number }[];
  uvDistortAdjustments?: WorkerSoftwareUvDistortAdjustment[];
  fisheyeAdjustments?: {
    projection: 'equidistant' | 'equisolid' | 'stereographic' | 'orthographic';
    strength: number;
    fieldOfView: number;
    curveBias: number;
    radius: number;
    zoom: number;
    centerX: number;
    centerY: number;
    squeeze: number;
    rotation: number;
    preserveAspect: boolean;
    outside: 'original' | 'transparent';
    feather: number;
    edgeMode: 'transparent' | 'clamp' | 'mirror' | 'repeat';
    edgeFeather: number;
    chromaticAberration: number;
    vignette: number;
    vignetteSoftness: number;
    samples: number;
  }[];
  motionBlurAdjustments?: { amount: number; angle: number }[];
  radialBlurAdjustments?: { amount: number; centerX: number; centerY: number; mode: 'zoom' | 'spin' }[];
  zoomBlurAdjustments?: { amount: number; centerX: number; centerY: number }[];
  sourceResamplingEffectCount?: number;
  feedbackEffectCount?: number;
  colorGradePrimaryNodes?: RuntimePrimaryColorParams[];
}

export function canvasCompositeOperationForBlendMode(
  blendMode: BlendMode,
): GlobalCompositeOperation | null {
  return CANVAS_COMPOSITE_BY_BLEND_MODE[blendMode] ?? null;
}

function finiteEffectNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createEmptyPixelEffects(
  colorGradePrimaryNodes?: readonly RuntimePrimaryColorParams[],
): MutableWorkerSoftwarePixelEffects {
  return {
    brightness: 0,
    ...(colorGradePrimaryNodes && colorGradePrimaryNodes.length > 0
      ? { colorGradePrimaryNodes: colorGradePrimaryNodes.map((node) => ({ ...node })) }
      : {}),
  };
}

function canAddSourceResamplingEffect(pixelEffects: MutableWorkerSoftwarePixelEffects): boolean {
  pixelEffects.sourceResamplingEffectCount = (pixelEffects.sourceResamplingEffectCount ?? 0) + 1;
  return pixelEffects.sourceResamplingEffectCount === 1;
}

function canAddFeedbackEffect(pixelEffects: MutableWorkerSoftwarePixelEffects): boolean {
  pixelEffects.feedbackEffectCount = (pixelEffects.feedbackEffectCount ?? 0) + 1;
  return pixelEffects.feedbackEffectCount === 1;
}

/** Canvas blur(px) for Gaussian and Box Blur (see effects/blur/blurSampling.ts for the GPU kernels). */
export function canvasBlurSigmaPx(type: 'gaussian-blur' | 'box-blur', radius: number,
  outputSize: { readonly width: number; readonly height: number } = DEFAULT_OUTPUT_SIZE): number {
  const radiusPx = Math.max(0, radius) * blurPixelScale(outputSize.width, outputSize.height);
  return type === 'gaussian-blur' ? radiusPx * GAUSSIAN_SIGMA_PER_RADIUS : Math.sqrt(radiusPx * (radiusPx + 1) / 3);
}

const DEFAULT_OUTPUT_SIZE = { width: 1920, height: 1080 } as const;

function effectFilterPart(
  effect: Effect,
  pixelEffects: MutableWorkerSoftwarePixelEffects,
  layerId: string,
  outputSize?: { readonly width: number; readonly height: number },
): string | null {
  if (effect.enabled === false || effect.type.startsWith('audio-')) return '';
  const effectType = effect.type as string;
  switch (effectType) {
    case 'acuarela':
      if (!canAddFeedbackEffect(pixelEffects)) return null;
      (pixelEffects.acuarelaAdjustments ??= []).push({
        feedbackKey: `${layerId}:${effect.id}`,
        opacity: finiteEffectNumber(effect.params.opacity, 1),
        gain: finiteEffectNumber(effect.params.gain, 0.01),
        speed: finiteEffectNumber(effect.params.speed, 4),
        detail: finiteEffectNumber(effect.params.detail, 4),
        strength: finiteEffectNumber(effect.params.strength, 0.32),
        density: finiteEffectNumber(effect.params.density, 4),
        gainX: finiteEffectNumber(effect.params.gainX, 0.3),
        gainY: finiteEffectNumber(effect.params.gainY, 0.3),
        reset: effect.params.reset === true,
        historyLoop: resolveFeedbackHistoryLoop(effect.params),
      });
      return '';
    case 'rom1':
      if (!canAddFeedbackEffect(pixelEffects)) return null;
      (pixelEffects.rom1Adjustments ??= []).push({
        feedbackKey: `${layerId}:${effect.id}`,
        opacity: finiteEffectNumber(effect.params.opacity, 1),
        gain: finiteEffectNumber(effect.params.gain, 0.01),
        speed: finiteEffectNumber(effect.params.speed, 4),
        detail: finiteEffectNumber(effect.params.detail, 4),
        strength: finiteEffectNumber(effect.params.strength, 0.32),
        density: finiteEffectNumber(effect.params.density, 4),
        gainX: finiteEffectNumber(effect.params.gainX, 0.3),
        gainY: finiteEffectNumber(effect.params.gainY, 0.3),
        reset: effect.params.reset === true,
        historyLoop: resolveFeedbackHistoryLoop(effect.params),
      });
      return '';
    case 'brightness':
      pixelEffects.brightness += finiteEffectNumber(effect.params.amount, 0);
      return '';
    case 'exposure':
      (pixelEffects.exposureAdjustments ??= []).push({
        exposure: finiteEffectNumber(effect.params.exposure, 0),
        offset: finiteEffectNumber(effect.params.offset, 0),
        gamma: Math.max(0.001, finiteEffectNumber(effect.params.gamma, 1)),
      });
      return '';
    case 'temperature':
      (pixelEffects.temperatureAdjustments ??= []).push({
        temperature: finiteEffectNumber(effect.params.temperature, 0),
        tint: finiteEffectNumber(effect.params.tint, 0),
      });
      return '';
    case 'vibrance':
      (pixelEffects.vibranceAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0),
      });
      return '';
    case 'levels':
      (pixelEffects.levelsAdjustments ??= []).push({
        inputBlack: finiteEffectNumber(effect.params.inputBlack, 0),
        inputWhite: finiteEffectNumber(effect.params.inputWhite, 1),
        gamma: Math.max(0.001, finiteEffectNumber(effect.params.gamma, 1)),
        outputBlack: finiteEffectNumber(effect.params.outputBlack, 0),
        outputWhite: finiteEffectNumber(effect.params.outputWhite, 1),
      });
      return '';
    case 'threshold':
      (pixelEffects.thresholdAdjustments ??= []).push({
        level: finiteEffectNumber(effect.params.level, 0.5),
      });
      return '';
    case 'posterize':
      (pixelEffects.posterizeAdjustments ??= []).push({
        levels: Math.max(2, finiteEffectNumber(effect.params.levels, 6)),
      });
      return '';
    case 'vignette':
      (pixelEffects.vignetteAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.5),
        size: finiteEffectNumber(effect.params.size, 0.5),
        softness: finiteEffectNumber(effect.params.softness, 0.5),
        roundness: finiteEffectNumber(effect.params.roundness, 1),
      });
      return '';
    case 'chroma-key': {
      const keyColor = effect.params.keyColor === 'blue' ? 'blue' : 'green';
      (pixelEffects.chromaKeyAdjustments ??= []).push({
        keyColor,
        tolerance: finiteEffectNumber(effect.params.tolerance, 0.2),
        softness: finiteEffectNumber(effect.params.softness, 0.1),
        spillSuppression: finiteEffectNumber(effect.params.spillSuppression, 0.5),
      });
      return '';
    }
    case 'edge-detect':
      (pixelEffects.edgeDetectAdjustments ??= []).push({
        strength: finiteEffectNumber(effect.params.strength, 1),
        invert: effect.params.invert === true,
      });
      return '';
    case 'sharpen':
      (pixelEffects.sharpenAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 1),
        radius: Math.max(0, finiteEffectNumber(effect.params.radius, 1)),
      });
      return '';
    case 'glow':
      (pixelEffects.glowAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 5),
        threshold: finiteEffectNumber(effect.params.threshold, 0.7935),
        radius: Math.max(0, finiteEffectNumber(effect.params.radius, 1)),
        softness: Math.max(0.001, finiteEffectNumber(effect.params.softness, 0.496)),
        // Clamped and truncated by the shared Glow sampling contract, like the GPU graph.
        rings: finiteEffectNumber(effect.params.rings, 6.85),
        samplesPerRing: finiteEffectNumber(effect.params.samplesPerRing, 17.95),
      });
      return '';
    case 'scanlines':
      (pixelEffects.scanlineAdjustments ??= []).push({
        density: finiteEffectNumber(effect.params.density, 5),
        opacity: finiteEffectNumber(effect.params.opacity, 0.3),
        speed: finiteEffectNumber(effect.params.speed, 0),
      });
      return '';
    case 'grain':
      (pixelEffects.grainAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.1),
        size: Math.max(0.001, finiteEffectNumber(effect.params.size, 1)),
        speed: finiteEffectNumber(effect.params.speed, 1),
      });
      return '';
    case 'wave':
    case 'twirl':
    case 'bulge': {
      // Only the untouched built-in recipe reaches this switch (see workerSoftwareEffectPlanForLayer).
      const adjustment = workerSoftwareUvDistortAdjustment(effect);
      if (adjustment === undefined) return null;
      if (adjustment === null) return '';
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.uvDistortAdjustments ??= []).push(adjustment);
      return '';
    }
    case 'kaleidoscope':
    case 'mirror':
    case 'pixelate':
    case 'rgb-split': {
      // Only the untouched built-in recipe reaches this switch (see workerSoftwareEffectPlanForLayer).
      const adjustment = workerSoftwareMirrorPixelAdjustment(effectType, effectOperatorParams(effect));
      if (adjustment) (pixelEffects.mirrorPixelAdjustments ??= []).push(adjustment);
      return '';
    }
    case 'fisheye': {
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      const projection = effect.params.projection;
      const edgeMode = effect.params.edgeMode;
      const parsedSamples = Number(effect.params.samples);
      (pixelEffects.fisheyeAdjustments ??= []).push({
        projection: projection === 'equisolid'
          || projection === 'stereographic'
          || projection === 'orthographic'
          ? projection
          : 'equidistant',
        strength: Math.max(-1, Math.min(1, finiteEffectNumber(effect.params.strength, 1))),
        fieldOfView: Math.max(20, Math.min(175, finiteEffectNumber(effect.params.fieldOfView, 140))),
        curveBias: Math.max(-1, Math.min(1, finiteEffectNumber(effect.params.curveBias, 0))),
        radius: Math.max(0.1, Math.min(3, finiteEffectNumber(effect.params.radius, 2.1))),
        zoom: Math.max(0.25, Math.min(4, finiteEffectNumber(effect.params.zoom, 1))),
        centerX: Math.max(0, Math.min(1, finiteEffectNumber(effect.params.centerX, 0.5))),
        centerY: Math.max(0, Math.min(1, finiteEffectNumber(effect.params.centerY, 0.5))),
        squeeze: Math.max(0.25, Math.min(4, finiteEffectNumber(effect.params.squeeze, 1))),
        rotation: Math.max(-180, Math.min(180, finiteEffectNumber(effect.params.rotation, 0))),
        preserveAspect: effect.params.preserveAspect !== false,
        outside: effect.params.outside === 'transparent' ? 'transparent' : 'original',
        feather: Math.max(0, Math.min(0.5, finiteEffectNumber(effect.params.feather, 0.05))),
        edgeMode: edgeMode === 'clamp' || edgeMode === 'mirror' || edgeMode === 'repeat'
          ? edgeMode
          : 'transparent',
        edgeFeather: Math.max(0, Math.min(0.1, finiteEffectNumber(effect.params.edgeFeather, 0.005))),
        chromaticAberration: Math.max(0, Math.min(0.05, finiteEffectNumber(effect.params.chromaticAberration, 0))),
        vignette: Math.max(0, Math.min(1, finiteEffectNumber(effect.params.vignette, 0))),
        vignetteSoftness: Math.max(0.01, Math.min(1, finiteEffectNumber(effect.params.vignetteSoftness, 0.25))),
        samples: parsedSamples >= 8 ? 8 : parsedSamples >= 4 ? 4 : 1,
      });
      return '';
    }
    case 'motion-blur':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      // Retired `samples` is ignored here as on the GPU; the tap count follows the streak length.
      (pixelEffects.motionBlurAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.05),
        angle: finiteEffectNumber(effect.params.angle, 0),
      });
      return '';
    case 'radial-blur':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.radialBlurAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.5),
        centerX: finiteEffectNumber(effect.params.centerX, 0.5),
        centerY: finiteEffectNumber(effect.params.centerY, 0.5),
        mode: radialBlurMode(effect.params.mode),
      });
      return '';
    case 'zoom-blur':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.zoomBlurAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.3),
        centerX: finiteEffectNumber(effect.params.centerX, 0.5),
        centerY: finiteEffectNumber(effect.params.centerY, 0.5),
      });
      return '';
    case 'blur': {
      const radius = Math.max(0, finiteEffectNumber(effect.params.radius, finiteEffectNumber(effect.params.amount, 10)));
      return radius > 0 ? `blur(${radius}px)` : '';
    }
    case 'gaussian-blur':
    case 'box-blur': {
      // Canvas blur(px) is a Gaussian standard deviation in output pixels: the GPU contract's
      // sigma (Gaussian) or the equal-variance width of the box, both in 1080p radius units.
      const sigma = canvasBlurSigmaPx(effectType, finiteEffectNumber(effect.params.radius, effectType === 'box-blur' ? 5 : 10), outputSize);
      return sigma > 0 ? `blur(${Math.round(sigma * 1000) / 1000}px)` : '';
    }
    case 'contrast':
      return `contrast(${Math.max(0, finiteEffectNumber(effect.params.amount, 1))})`;
    case 'saturation':
      return `saturate(${Math.max(0, finiteEffectNumber(effect.params.amount, 1))})`;
    case 'hue-shift':
      return `hue-rotate(${finiteEffectNumber(effect.params.shift, 0) * 360}deg)`;
    case 'invert':
      return 'invert(1)';
    default:
      return null;
  }
}

export function workerSoftwareEffectPlanForLayer(layer: Layer,
  outputSize?: { readonly width: number; readonly height: number }): WorkerSoftwareEffectPlan | null {
  const pixelEffects = createEmptyPixelEffects(layer.colorCorrection?.primaryNodes);
  const activeEffects = layer.effects.filter(effect => effect.enabled !== false && !effect.type.startsWith('audio-'));
  // Built-in Wave, Twirl and Bulge keep a hand-written pass even with a stored copy of their
  // recipe (interpreting their graph per pixel is far slower); edited graphs run as graphs.
  const hasPersistedImageGraph = activeEffects.some(effect => isImageGraphEffectType(effect.type)
    && (effect.operatorGraph || effect.params.operatorGraph !== undefined) && workerSoftwareUvDistortAdjustment(effect) === undefined
    && !(HAND_WRITTEN_MIRROR_PIXEL.has(effect.type) && rendersBuiltInMirrorPixelRecipe(effect)));
  const graphPlans = (): WorkerSoftwareEffectPlan | null => {
    if (!activeEffects.every(effect => isImageGraphEffectType(effect.type))) return null;
    try {
      const plans: ImageOperatorPlan[] = [];
      const owners: import('./workerSoftwareImageGraphs').WorkerSoftwareImageGraphOwner[] = [];
      for (const effect of activeEffects) {
        const { plan } = prepareImageEffect(effect);
        if (!plan) continue;
        if (!canApplyWorkerSoftwareImageGraphPlan(plan)) return null;
        plans.push(plan);
        owners.push({ feedbackKey: JSON.stringify([layer.id, effect.id]), reset: effect.params.reset === true,
          historyLoop: resolveFeedbackHistoryLoop(effect.params) });
      }
      const graphEffects = createEmptyPixelEffects(layer.colorCorrection?.primaryNodes);
      graphEffects.imageOperatorPlans = plans;
      graphEffects.imageOperatorPlanOwners = owners;
      return { filter: 'none', pixelEffects: graphEffects };
    } catch { return null; }
  };
  if (hasPersistedImageGraph) return graphPlans();
  // The hand-written pass holds one resampling effect; stacked built-in distorts (Wave then
  // Twirl, …) run as ordered graph plans instead of skipping the layer.
  const stackedFallback = () => activeEffects.some(effect => workerSoftwareUvDistortAdjustment(effect)) ? graphPlans() : null;
  const parts: string[] = [];
  let activeVisualEffectCount = 0;
  for (const effect of layer.effects) {
    if (effect.enabled !== false && !effect.type.startsWith('audio-')) {
      activeVisualEffectCount += 1;
    }
    const part = effectFilterPart(effect, pixelEffects, layer.id, outputSize);
    if (part === null) return stackedFallback();
    if (part) parts.push(part);
  }
  const feedbackEffectCount = (pixelEffects.acuarelaAdjustments?.length ?? 0)
    + (pixelEffects.rom1Adjustments?.length ?? 0);
  if (feedbackEffectCount > 0 && activeVisualEffectCount !== feedbackEffectCount) {
    return null;
  }
  delete pixelEffects.feedbackEffectCount;
  delete pixelEffects.sourceResamplingEffectCount;
  return {
    filter: parts.length > 0 ? parts.join(' ') : 'none',
    pixelEffects,
  };
}

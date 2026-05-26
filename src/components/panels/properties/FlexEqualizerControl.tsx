import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import {
  addAudioEqBand,
  removeAudioEqBand,
  updateAudioEqBand,
} from '../../../engine/audio/eq/AudioEqOperations';
import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
  createDefaultAudioEqBandDynamics,
  createDefaultAudioEqBandSpectralDynamics,
} from '../../../engine/audio/eq/AudioEqDefaults';
import {
  applyAudioEqCurveFit,
  applyAudioEqMatch,
  type AudioEqCurvePoint,
} from '../../../engine/audio/eq/AudioEqCurveFitting';
import {
  applyAudioEqSpectrumGrabPeak,
  detectAudioEqSpectrumGrabPeaks,
  type AudioEqSpectrumGrabPeak,
} from '../../../engine/audio/eq/AudioEqSpectrumGrab';
import {
  applyAudioEqPreset,
  createAudioEqParamsForPresetKind,
  getAudioEqFactoryPresets,
} from '../../../engine/audio/eq/AudioEqPresets';
import type { AudioEqPreset } from '../../../engine/audio/eq/AudioEqPresets';
import {
  copyAudioEqBands,
  copyAudioEqCurve,
  parseAudioEqClipboardPayload,
  pasteAudioEqClipboardPayload,
  serializeAudioEqClipboardPayload,
} from '../../../engine/audio/eq/AudioEqClipboard';
import {
  createAudioEqABState,
  switchAudioEqABSlot,
  syncAudioEqABActiveSlot,
} from '../../../engine/audio/eq/AudioEqAB';
import {
  createAudioEqGraphViewModel,
  dbToGraphY,
  frequencyToGraphX,
} from '../../../engine/audio/eq/AudioEqGraphViewModel';
import { getAudioEqSpectralDynamicsBandRange } from '../../../engine/audio/eq/AudioEqSpectralDynamics';
import type {
  AudioEqAnalyzerView,
  AudioEqBand,
  AudioEqBandDynamics,
  AudioEqBandSpectralDynamics,
  AudioEqBandType,
  AudioEqAnalyzerMode,
  AudioEqCharacterMode,
  AudioEqParamsV2,
  AudioEqPhaseMode,
  AudioEqPresetKind,
} from '../../../engine/audio/eq/AudioEqTypes';
import type { AudioEqABSlot, AudioEqABState } from '../../../engine/audio/eq/AudioEqAB';
import type { AudioEffectParamValue } from '../../../types';
import {
  createAndSaveAudioEqUserPreset,
  deleteAudioEqUserPreset,
  loadAudioEqPresetFavoriteIds,
  loadAudioEqUserPresets,
  toggleAudioEqPresetFavoriteId,
} from '../../../services/audio/audioEqPresetStorage';
import { DraggableNumber, EffectKeyframeToggle, MultiKeyframeToggle } from './shared';
import { createAudioEqBandNumericProperty, getAudioEqBandNumericKeyframeEntries } from './audioEqKeyframes';
import { formatEqualizerFrequency } from './equalizerFormatting';

const GRAPH_MIN_FREQUENCY_HZ = 20;
const GRAPH_MAX_FREQUENCY_HZ = 20000;
const DEFAULT_GRAPH_WIDTH = 520;
const DEFAULT_GRAPH_HEIGHT = 220;
const COMPACT_GRAPH_HEIGHT = 156;
const GAIN_STEP_DB = 0.1;

type FlexEqGraphMode = 'edit' | 'sketch' | 'grab';
type FlexEqPresetSource = 'factory' | 'user';
type FlexEqPresetFilter = 'all' | 'favorites' | 'user';

interface FlexEqBrowserPreset extends AudioEqPreset {
  source: FlexEqPresetSource;
}

const BAND_TYPE_OPTIONS: Array<{ value: AudioEqBandType; label: string }> = [
  { value: 'bell', label: 'Bell' },
  { value: 'low-shelf', label: 'Low Shelf' },
  { value: 'high-shelf', label: 'High Shelf' },
  { value: 'low-cut', label: 'Low Cut' },
  { value: 'high-cut', label: 'High Cut' },
  { value: 'notch', label: 'Notch' },
  { value: 'band-pass', label: 'Band Pass' },
  { value: 'tilt-shelf', label: 'Tilt' },
  { value: 'all-pass', label: 'All Pass' },
];

const PRESET_OPTIONS: Array<{ value: AudioEqPresetKind; label: string }> = [
  { value: '3-band', label: '3' },
  { value: '10-band-graphic', label: '10' },
  { value: 'parametric', label: 'Param' },
  { value: 'mastering', label: 'Master' },
  { value: 'custom', label: 'Custom' },
];
const ANALYZER_VIEW_OPTIONS: Array<{ value: AudioEqAnalyzerMode; label: string }> = [
  { value: 'pre', label: 'Source' },
  { value: 'post', label: 'EQ' },
  { value: 'pre-post', label: 'Both' },
];
const FACTORY_PRESETS = getAudioEqFactoryPresets();

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function quantize(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(3));
}

function graphXToFrequency(x: number, width: number): number {
  const minLog = Math.log10(GRAPH_MIN_FREQUENCY_HZ);
  const maxLog = Math.log10(GRAPH_MAX_FREQUENCY_HZ);
  const normalized = clamp(x / Math.max(1, width), 0, 1);
  return Math.pow(10, minLog + normalized * (maxLog - minLog));
}

function graphYToDb(y: number, height: number, rangeDb: number): number {
  const normalized = clamp(y / Math.max(1, height), 0, 1);
  return quantize(rangeDb - normalized * rangeDb * 2, GAIN_STEP_DB);
}

function formatSignedDb(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)} dB`;
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const bigint = Number.parseInt(raw.length === 3
    ? raw.split('').map(char => char + char).join('')
    : raw, 16);
  if (!Number.isFinite(bigint)) return `rgba(255, 255, 255, ${alpha})`;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function bandNeedsGain(band: AudioEqBand): boolean {
  return band.type === 'bell' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf' ||
    band.type === 'tilt-shelf';
}

function bandHasFrequencyHandle(band: AudioEqBand): boolean {
  return band.type !== 'all-pass' || Math.abs(band.gainDb) > 0.0001;
}

function createDefaultBandDynamics(): AudioEqBandDynamics {
  return { ...createDefaultAudioEqBandDynamics(), enabled: true };
}

function createDefaultBandSpectralDynamics(): AudioEqBandSpectralDynamics {
  return { ...createDefaultAudioEqBandSpectralDynamics(), enabled: true };
}

function drawFrequencyGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rangeDb: number,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.textBaseline = 'top';

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#15141c');
  background.addColorStop(0.5, '#101119');
  background.addColorStop(1, '#0b0d13');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  for (let decade = 10; decade <= 10000; decade *= 10) {
    for (let multiplier = 1; multiplier < 10; multiplier += 1) {
      const frequency = decade * multiplier;
      if (frequency < GRAPH_MIN_FREQUENCY_HZ || frequency > GRAPH_MAX_FREQUENCY_HZ) continue;
      const x = frequencyToGraphX(frequency, width);
      const major = multiplier === 1 || multiplier === 2 || multiplier === 5;
      ctx.strokeStyle = major ? 'rgba(167, 180, 205, 0.22)' : 'rgba(167, 180, 205, 0.075)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  const dbStep = rangeDb <= 6 ? 1.5 : rangeDb <= 12 ? 3 : 6;
  for (let db = -rangeDb; db <= rangeDb + 0.001; db += dbStep) {
    const y = dbToGraphY(db, height, rangeDb);
    ctx.strokeStyle = Math.abs(db) < 0.001 ? 'rgba(255, 231, 98, 0.44)' : 'rgba(167, 180, 205, 0.12)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    if (Math.abs(db % (dbStep * 2)) < 0.001 || Math.abs(db) < 0.001) {
      ctx.fillStyle = 'rgba(217, 224, 238, 0.62)';
      ctx.fillText(db > 0 ? `+${db}` : `${db}`, width - 28, y + 3);
    }
  }

  const labels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  ctx.fillStyle = 'rgba(217, 224, 238, 0.54)';
  ctx.textAlign = 'center';
  for (const frequency of labels) {
    const x = clamp(frequencyToGraphX(frequency, width), 18, width - 20);
    ctx.fillText(formatEqualizerFrequency(frequency), x, height - 17);
  }

  ctx.restore();
}

function drawSpectralDynamicsOverlays(
  ctx: CanvasRenderingContext2D,
  bands: readonly AudioEqBand[],
  width: number,
  height: number,
  selectedBandIds: readonly string[],
): void {
  const activeBands = bands.filter(band => (
    band.enabled !== false &&
    band.spectralDynamics?.enabled === true &&
    band.type !== 'all-pass'
  ));
  if (activeBands.length === 0) return;

  ctx.save();
  for (const band of activeBands) {
    const selected = selectedBandIds.includes(band.id);
    const range = getAudioEqSpectralDynamicsBandRange(band, 48_000);
    const x0 = clamp(frequencyToGraphX(Math.max(GRAPH_MIN_FREQUENCY_HZ, range.minHz), width), 0, width);
    const x1 = clamp(frequencyToGraphX(Math.min(GRAPH_MAX_FREQUENCY_HZ, range.maxHz), width), 0, width);
    const left = Math.min(x0, x1);
    const bandWidth = Math.max(1, Math.abs(x1 - x0));
    const gradient = ctx.createLinearGradient(left, 0, left + bandWidth, 0);
    gradient.addColorStop(0, selected ? 'rgba(112, 246, 220, 0.02)' : 'rgba(112, 246, 220, 0.01)');
    gradient.addColorStop(0.5, selected ? 'rgba(112, 246, 220, 0.22)' : 'rgba(112, 246, 220, 0.10)');
    gradient.addColorStop(1, selected ? 'rgba(112, 246, 220, 0.02)' : 'rgba(112, 246, 220, 0.01)');
    ctx.fillStyle = gradient;
    ctx.fillRect(left, 0, bandWidth, height);
    ctx.strokeStyle = selected ? 'rgba(112, 246, 220, 0.54)' : 'rgba(112, 246, 220, 0.22)';
    ctx.lineWidth = selected ? 1.1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left, height);
    ctx.moveTo(left + bandWidth, 0);
    ctx.lineTo(left + bandWidth, height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnalyzer(
  ctx: CanvasRenderingContext2D,
  valuesDb: Float32Array | undefined,
  width: number,
  height: number,
  fillColor: string,
  strokeColor: string,
): void {
  if (!valuesDb || valuesDb.length < 2) return;
  const minDb = -96;
  const maxDb = -18;
  const yForDb = (value: number) => {
    const normalized = (clamp(value, minDb, maxDb) - minDb) / (maxDb - minDb);
    return height - normalized * height;
  };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let index = 0; index < valuesDb.length; index += 1) {
    const normalized = index / Math.max(1, valuesDb.length - 1);
    const frequency = GRAPH_MIN_FREQUENCY_HZ *
      Math.pow(GRAPH_MAX_FREQUENCY_HZ / GRAPH_MIN_FREQUENCY_HZ, normalized);
    ctx.lineTo(frequencyToGraphX(frequency, width), yForDb(valuesDb[index]));
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, fillColor);
  fill.addColorStop(1, 'rgba(178, 186, 204, 0.03)');
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  for (let index = 0; index < valuesDb.length; index += 1) {
    const normalized = index / Math.max(1, valuesDb.length - 1);
    const frequency = GRAPH_MIN_FREQUENCY_HZ *
      Math.pow(GRAPH_MAX_FREQUENCY_HZ / GRAPH_MIN_FREQUENCY_HZ, normalized);
    const x = frequencyToGraphX(frequency, width);
    const y = yForDb(valuesDb[index]);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
}

function analyzerDbToY(value: number, height: number): number {
  const minDb = -96;
  const maxDb = -18;
  const normalized = (clamp(value, minDb, maxDb) - minDb) / (maxDb - minDb);
  return height - normalized * height;
}

function drawSketchPreview(
  ctx: CanvasRenderingContext2D,
  points: readonly AudioEqCurvePoint[],
  width: number,
  height: number,
  rangeDb: number,
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = frequencyToGraphX(point.frequencyHz, width);
    const y = dbToGraphY(point.gainDb, height, rangeDb);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = 'rgba(112, 246, 220, 0.95)';
  ctx.lineWidth = 2.4;
  ctx.shadowColor = 'rgba(112, 246, 220, 0.35)';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();
}

function drawSpectrumGrabPeaks(
  ctx: CanvasRenderingContext2D,
  peaks: readonly AudioEqSpectrumGrabPeak[],
  width: number,
  height: number,
): void {
  if (peaks.length === 0) return;

  ctx.save();
  for (const peak of peaks) {
    const x = frequencyToGraphX(peak.frequencyHz, width);
    const y = clamp(analyzerDbToY(peak.magnitudeDb, height), 12, height - 18);
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7, y + 5);
    ctx.lineTo(x - 7, y + 5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(112, 246, 220, 0.88)';
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.stroke();
  }
  ctx.restore();
}

function drawResponseArea(
  ctx: CanvasRenderingContext2D,
  frequencies: Float32Array,
  valuesDb: Float32Array,
  width: number,
  height: number,
  rangeDb: number,
  color: string,
  alpha: number,
): void {
  if (frequencies.length === 0 || valuesDb.length === 0) return;
  const zeroY = dbToGraphY(0, height, rangeDb);
  ctx.beginPath();
  ctx.moveTo(frequencyToGraphX(frequencies[0], width), zeroY);
  for (let index = 0; index < frequencies.length; index += 1) {
    ctx.lineTo(
      frequencyToGraphX(frequencies[index], width),
      dbToGraphY(valuesDb[index] ?? 0, height, rangeDb),
    );
  }
  ctx.lineTo(frequencyToGraphX(frequencies[frequencies.length - 1], width), zeroY);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(color, alpha);
  ctx.fill();
}

function drawResponseCurve(
  ctx: CanvasRenderingContext2D,
  frequencies: Float32Array,
  valuesDb: Float32Array,
  width: number,
  height: number,
  rangeDb: number,
): void {
  if (frequencies.length === 0 || valuesDb.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let index = 0; index < frequencies.length; index += 1) {
    const x = frequencyToGraphX(frequencies[index], width);
    const y = dbToGraphY(valuesDb[index] ?? 0, height, rangeDb);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.74)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = '#f1d34f';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}

function drawEqualizerCanvas(
  canvas: HTMLCanvasElement,
  params: AudioEqParamsV2,
  analyzer: AudioEqAnalyzerView | undefined,
  hoveredBandId: string | undefined,
  selectedBandIds: readonly string[],
  soloBandIds: readonly string[],
  graphMode: FlexEqGraphMode,
  sketchPoints: readonly AudioEqCurvePoint[],
  grabPeaks: readonly AudioEqSpectrumGrabPeak[],
): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || DEFAULT_GRAPH_WIDTH));
  const height = Math.max(1, Math.round(rect.height || DEFAULT_GRAPH_HEIGHT));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const view = createAudioEqGraphViewModel(params, {
    width,
    height,
    devicePixelRatio: dpr,
    analyzer,
    hoveredBandId,
  });

  drawFrequencyGrid(ctx, width, height, view.rangeDb);
  const analyzerMode = params.display.analyzerMode === 'off' ? 'post' : params.display.analyzerMode;
  if (analyzerMode === 'pre' || analyzerMode === 'pre-post') {
    drawAnalyzer(ctx, view.analyzer?.preDb, width, height, 'rgba(156, 161, 178, 0.22)', 'rgba(210, 218, 232, 0.34)');
  }
  if (analyzerMode === 'post' || analyzerMode === 'pre-post') {
    drawAnalyzer(ctx, view.analyzer?.postDb, width, height, 'rgba(241, 211, 79, 0.13)', 'rgba(241, 211, 79, 0.42)');
  }
  drawSpectralDynamicsOverlays(ctx, params.audible.bands, width, height, selectedBandIds);
  if (graphMode === 'grab') {
    drawSpectrumGrabPeaks(ctx, grabPeaks, width, height);
  }

  const soloSet = new Set(soloBandIds);
  const hasSolo = soloSet.size > 0;
  for (const band of view.bandResponses) {
    if (!band.enabled) continue;
    drawResponseArea(
      ctx,
      view.xFrequenciesHz,
      band.responseDb,
      width,
      height,
      view.rangeDb,
      band.color,
      hasSolo && !soloSet.has(band.bandId) ? 0.06 : 0.24,
    );
  }

  drawResponseArea(ctx, view.xFrequenciesHz, view.summedResponseDb, width, height, view.rangeDb, '#b149ff', 0.18);
  drawResponseCurve(ctx, view.xFrequenciesHz, view.summedResponseDb, width, height, view.rangeDb);

  for (const band of view.bandResponses) {
    const selected = selectedBandIds.includes(band.bandId);
    const hovered = hoveredBandId === band.bandId;
    ctx.save();
    ctx.globalAlpha = band.enabled ? (hasSolo && !soloSet.has(band.bandId) ? 0.32 : 1) : 0.36;
    ctx.beginPath();
    ctx.arc(band.handle.x, band.handle.y, selected || hovered ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fillStyle = band.color;
    ctx.fill();
    ctx.lineWidth = selected || hovered ? 2.2 : 1.3;
    ctx.strokeStyle = selected || hovered ? '#ffffff' : 'rgba(255,255,255,0.72)';
    ctx.stroke();
    ctx.restore();
  }

  if (graphMode === 'sketch') {
    drawSketchPreview(ctx, sketchPoints, width, height, view.rangeDb);
  }
}

function useElementSize(ref: { current: HTMLElement | null }, fallbackHeight: number) {
  const [size, setSize] = useState({ width: DEFAULT_GRAPH_WIDTH, height: fallbackHeight });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.round(rect.width || DEFAULT_GRAPH_WIDTH)),
        height: Math.max(1, Math.round(rect.height || fallbackHeight)),
      });
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallbackHeight, ref]);

  return size;
}

export interface FlexEqualizerControlProps {
  params: unknown;
  compact?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  analyzer?: AudioEqAnalyzerView;
  keyframeClipId?: string;
  effectId?: string;
  onUpdateParamPath?: (path: string, value: AudioEffectParamValue) => void;
  onChangeParams?: (params: AudioEqParamsV2) => void;
}

export function FlexEqualizerControl({
  params,
  compact = false,
  disabled = false,
  ariaLabel = 'Equalizer',
  analyzer,
  keyframeClipId,
  effectId,
  onUpdateParamPath,
  onChangeParams,
}: FlexEqualizerControlProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeBandIdRef = useRef<string | null>(null);
  const activeSketchPointerIdRef = useRef<number | null>(null);
  const graphHeight = compact ? COMPACT_GRAPH_HEIGHT : DEFAULT_GRAPH_HEIGHT;
  const size = useElementSize(stageRef, graphHeight);
  const normalized = useMemo(() => normalizeAudioEqParams(params), [params]);
  const selectedBandIds = useMemo(
    () => normalized.display.selectedBandIds ?? [],
    [normalized.display.selectedBandIds],
  );
  const soloBandIds = useMemo(
    () => normalized.display.soloBandIds ?? [],
    [normalized.display.soloBandIds],
  );
  const selectedBandId = selectedBandIds[0] ?? normalized.audible.bands[0]?.id;
  const selectedBand = normalized.audible.bands.find(band => band.id === selectedBandId) ?? normalized.audible.bands[0];
  const [hoveredBandId, setHoveredBandId] = useState<string | undefined>();
  const [abState, setAbState] = useState<AudioEqABState>(() => createAudioEqABState(normalized));
  const [graphMode, setGraphMode] = useState<FlexEqGraphMode>('edit');
  const [sketchPoints, setSketchPoints] = useState<AudioEqCurvePoint[]>([]);
  const [matchSource, setMatchSource] = useState<Float32Array | undefined>();
  const [matchTarget, setMatchTarget] = useState<Float32Array | undefined>();
  const [userPresets, setUserPresets] = useState<AudioEqPreset[]>(() => loadAudioEqUserPresets());
  const [favoritePresetIds, setFavoritePresetIds] = useState<string[]>(() => loadAudioEqPresetFavoriteIds());
  const [presetQuery, setPresetQuery] = useState('');
  const [presetTagFilter, setPresetTagFilter] = useState('');
  const [presetFilter, setPresetFilter] = useState<FlexEqPresetFilter>('all');

  const view = useMemo(() => createAudioEqGraphViewModel(normalized, {
    width: size.width,
    height: size.height,
    analyzer,
    hoveredBandId,
  }), [analyzer, hoveredBandId, normalized, size.height, size.width]);
  const grabPeaks = useMemo(
    () => detectAudioEqSpectrumGrabPeaks(analyzer?.postDb ?? analyzer?.preDb, { maxPeaks: 8 }),
    [analyzer?.postDb, analyzer?.preDb],
  );
  const selectedBandAllKeyframeEntries = useMemo(
    () => selectedBand && effectId ? getAudioEqBandNumericKeyframeEntries(effectId, selectedBand) : [],
    [effectId, selectedBand],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawEqualizerCanvas(canvas, normalized, analyzer, hoveredBandId, selectedBandIds, soloBandIds, graphMode, sketchPoints, grabPeaks);
  }, [analyzer, grabPeaks, graphMode, hoveredBandId, normalized, selectedBandIds, size.height, size.width, sketchPoints, soloBandIds]);

  const browserPresets = useMemo<FlexEqBrowserPreset[]>(() => {
    const favorites = new Set(favoritePresetIds);
    return [
      ...FACTORY_PRESETS.map(preset => ({
        ...preset,
        source: 'factory' as const,
        favorite: preset.favorite || favorites.has(preset.id),
      })),
      ...userPresets.map(preset => ({
        ...preset,
        source: 'user' as const,
        favorite: preset.favorite || favorites.has(preset.id),
      })),
    ];
  }, [favoritePresetIds, userPresets]);

  const presetTags = useMemo(() => {
    const tags = new Set<string>();
    for (const preset of browserPresets) {
      for (const tag of preset.tags) tags.add(tag);
    }
    return [...tags].toSorted((a, b) => a.localeCompare(b));
  }, [browserPresets]);

  const filteredPresets = useMemo(() => {
    const query = presetQuery.trim().toLowerCase();
    return browserPresets.filter((preset) => {
      if (presetFilter === 'favorites' && !preset.favorite) return false;
      if (presetFilter === 'user' && preset.source !== 'user') return false;
      if (presetTagFilter && !preset.tags.includes(presetTagFilter)) return false;
      if (!query) return true;
      return preset.name.toLowerCase().includes(query) ||
        preset.tags.some(tag => tag.toLowerCase().includes(query));
    });
  }, [browserPresets, presetFilter, presetQuery, presetTagFilter]);

  const commitParams = (next: AudioEqParamsV2) => {
    onChangeParams?.(next);
  };

  const updatePath = (path: string, value: AudioEffectParamValue) => {
    onUpdateParamPath?.(path, value);
  };

  const setSelectedBand = (bandId: string) => {
    updatePath('eq.display.selectedBandIds', [bandId]);
  };

  const toggleSoloBand = (bandId: string) => {
    const current = new Set(soloBandIds);
    if (current.has(bandId)) {
      current.delete(bandId);
    } else {
      current.add(bandId);
    }
    updatePath('eq.display.soloBandIds', [...current]);
  };

  const updateBand = (bandId: string, patch: Partial<AudioEqBand>) => {
    if (patch.frequencyHz !== undefined) updatePath(`eq.audible.bands.${bandId}.frequencyHz`, patch.frequencyHz);
    if (patch.gainDb !== undefined) updatePath(`eq.audible.bands.${bandId}.gainDb`, patch.gainDb);
    if (patch.q !== undefined) updatePath(`eq.audible.bands.${bandId}.q`, patch.q);
    if (patch.type !== undefined) updatePath(`eq.audible.bands.${bandId}.type`, patch.type);
    if (patch.enabled !== undefined) updatePath(`eq.audible.bands.${bandId}.enabled`, patch.enabled);
    if (patch.dynamic !== undefined) updatePath(`eq.audible.bands.${bandId}.dynamic`, patch.dynamic as unknown as AudioEffectParamValue);
    if (patch.spectralDynamics !== undefined) updatePath(`eq.audible.bands.${bandId}.spectralDynamics`, patch.spectralDynamics as unknown as AudioEffectParamValue);
  };

  const updateBandDynamics = (band: AudioEqBand, patch: Partial<AudioEqBandDynamics>) => {
    updateBand(band.id, {
      dynamic: {
        ...(band.dynamic ?? createDefaultBandDynamics()),
        ...patch,
      },
    });
  };

  const updateBandSpectralDynamics = (band: AudioEqBand, patch: Partial<AudioEqBandSpectralDynamics>) => {
    updateBand(band.id, {
      spectralDynamics: {
        ...(band.spectralDynamics ?? createDefaultBandSpectralDynamics()),
        ...patch,
      },
    });
  };

  const renderBandNumericKeyframeToggle = (band: AudioEqBand, paramPath: string, value: number) => (
    keyframeClipId && effectId
      ? (
          <EffectKeyframeToggle
            clipId={keyframeClipId}
            property={createAudioEqBandNumericProperty(effectId, band.id, paramPath)}
            value={value}
          />
        )
      : null
  );

  const graphPointToCurvePoint = (point: { x: number; y: number }): AudioEqCurvePoint => ({
    frequencyHz: clamp(graphXToFrequency(point.x, size.width), GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ),
    gainDb: clamp(graphYToDb(point.y, size.height, normalized.display.graphRangeDb), -30, 30),
  });

  const copySpectrumSnapshot = (values: Float32Array | undefined): Float32Array | undefined => {
    if (!values) return undefined;
    const copy = new Float32Array(values.length);
    copy.set(values);
    return copy;
  };

  const currentSpectrumSnapshot = () => copySpectrumSnapshot(analyzer?.postDb ?? analyzer?.preDb);

  const captureMatchSource = () => {
    if (disabled) return;
    setMatchSource(currentSpectrumSnapshot());
  };

  const captureMatchTarget = () => {
    if (disabled) return;
    setMatchTarget(currentSpectrumSnapshot());
  };

  const applyCapturedMatch = () => {
    if (disabled || !matchSource || !matchTarget) return;
    commitParams(applyAudioEqMatch(normalized, matchSource, matchTarget, {
      amount: 0.85,
      smoothing: 0.45,
      maxBands: 8,
    }));
    setGraphMode('edit');
  };

  const nearestGrabPeak = (x: number): AudioEqSpectrumGrabPeak | null => {
    let best: AudioEqSpectrumGrabPeak | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const peak of grabPeaks) {
      const distance = Math.abs(frequencyToGraphX(peak.frequencyHz, size.width) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = peak;
      }
    }
    return bestDistance <= 16 ? best : null;
  };

  const getPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  };

  const nearestBandId = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const band of view.bandResponses) {
      const dx = band.handle.x - x;
      const dy = (band.handle.y - y) * 1.35;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = band.bandId;
      }
    }
    return best;
  };

  const updateBandFromPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    bandId: string,
  ) => {
    if (disabled) return;
    const point = getPoint(event);
    if (!point) return;
    const band = normalized.audible.bands.find(candidate => candidate.id === bandId);
    if (!band || !bandHasFrequencyHandle(band)) return;

    const nextFrequency = clamp(graphXToFrequency(point.x, size.width), GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ);
    const nextGain = bandNeedsGain(band)
      ? clamp(graphYToDb(point.y, size.height, normalized.display.graphRangeDb), -60, 60)
      : band.gainDb;
    updateBand(bandId, {
      frequencyHz: quantize(nextFrequency, nextFrequency < 100 ? 1 : nextFrequency < 1000 ? 5 : 10),
      gainDb: nextGain,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.button !== 0) return;
    const point = getPoint(event);
    if (!point) return;

    if (graphMode === 'sketch') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      activeSketchPointerIdRef.current = event.pointerId;
      setSketchPoints([graphPointToCurvePoint(point)]);
      return;
    }

    if (graphMode === 'grab') {
      const peak = nearestGrabPeak(point.x);
      if (!peak) return;
      event.preventDefault();
      commitParams(applyAudioEqSpectrumGrabPeak(normalized, peak, { replaceNearest: true }));
      setGraphMode('edit');
      return;
    }

    const bandId = nearestBandId(point.x, point.y);
    if (!bandId) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    activeBandIdRef.current = bandId;
    setSelectedBand(bandId);
    updateBandFromPointer(event, bandId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getPoint(event);

    if (graphMode === 'sketch' && activeSketchPointerIdRef.current === event.pointerId && point) {
      event.preventDefault();
      const nextPoint = graphPointToCurvePoint(point);
      setSketchPoints(current => {
        const previous = current[current.length - 1];
        if (
          previous &&
          Math.abs(Math.log2(previous.frequencyHz / nextPoint.frequencyHz)) < 0.01 &&
          Math.abs(previous.gainDb - nextPoint.gainDb) < 0.15
        ) {
          return current;
        }
        return [...current, nextPoint].slice(-160);
      });
      return;
    }

    if (point && activePointerIdRef.current === null) {
      setHoveredBandId(nearestBandId(point.x, point.y) ?? undefined);
    }

    if (activePointerIdRef.current !== event.pointerId || !activeBandIdRef.current) {
      return;
    }

    event.preventDefault();
    updateBandFromPointer(event, activeBandIdRef.current);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activeSketchPointerIdRef.current === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released.
      }
      activeSketchPointerIdRef.current = null;
      const completedSketch = sketchPoints;
      setSketchPoints([]);
      if (completedSketch.length >= 3) {
        commitParams(applyAudioEqCurveFit(normalized, completedSketch, {
          maxBands: 8,
          source: 'sketch',
        }));
        setGraphMode('edit');
      }
      return;
    }

    if (activePointerIdRef.current !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released.
    }
    activePointerIdRef.current = null;
    activeBandIdRef.current = null;
  };

  const addBand = (type: AudioEqBandType, frequencyHz: number) => {
    if (disabled) return;
    commitParams(addAudioEqBand(normalized, {
      type,
      frequencyHz,
      gainDb: type === 'low-cut' || type === 'high-cut' || type === 'notch' ? 0 : 1.5,
      q: type === 'low-cut' || type === 'high-cut' ? 0.707 : 1.1,
    }));
  };

  const updatePresetKind = (kind: AudioEqPresetKind) => {
    if (disabled) return;
    if (kind === 'custom') {
      updatePath('eq.audible.presetKind', 'custom');
      return;
    }
    commitParams(createAudioEqParamsForPresetKind(kind));
  };

  const applyBrowserPreset = (presetId: string) => {
    if (disabled || !presetId) return;
    const preset = browserPresets.find(candidate => candidate.id === presetId);
    if (!preset) return;
    commitParams(applyAudioEqPreset(normalized, preset, 'full'));
  };

  const saveCurrentUserPreset = () => {
    if (disabled) return;
    const fallbackName = `EQ ${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt?.('Preset name', fallbackName)?.trim();
    if (!name) return;
    const tags = [
      normalized.audible.presetKind,
      normalized.audible.characterMode !== 'clean' ? normalized.audible.characterMode : undefined,
      normalized.audible.bands.some(band => band.dynamic?.enabled) ? 'dynamic' : undefined,
      normalized.audible.bands.some(band => band.spectralDynamics?.enabled) ? 'spectral' : undefined,
    ].filter((tag): tag is string => Boolean(tag));
    setUserPresets(createAndSaveAudioEqUserPreset({
      name,
      tags,
      params: normalized,
      favorite: false,
    }));
  };

  const deleteBrowserPreset = (preset: FlexEqBrowserPreset) => {
    if (disabled || preset.source !== 'user') return;
    setUserPresets(deleteAudioEqUserPreset(preset.id));
  };

  const toggleBrowserPresetFavorite = (presetId: string) => {
    if (disabled) return;
    setFavoritePresetIds(toggleAudioEqPresetFavoriteId(presetId));
  };

  const switchABSlot = (slot: AudioEqABSlot) => {
    if (disabled || abState.activeSlot === slot) return;
    const result = switchAudioEqABSlot(abState, normalized, slot);
    setAbState(result.state);
    commitParams(result.params);
  };

  const syncActiveABSlot = () => {
    setAbState(current => syncAudioEqABActiveSlot(current, normalized));
  };

  const writeClipboardPayload = async (payloadText: string) => {
    await navigator.clipboard.writeText(payloadText);
  };

  const handleCopyCurve = async () => {
    if (disabled || !navigator.clipboard) return;
    try {
      await writeClipboardPayload(serializeAudioEqClipboardPayload(copyAudioEqCurve(normalized)));
    } catch {
      // Clipboard permission can be unavailable in embedded or headless contexts.
    }
  };

  const handleCopyBands = async () => {
    if (disabled || !navigator.clipboard) return;
    const ids = selectedBandIds.length > 0
      ? selectedBandIds
      : selectedBand
        ? [selectedBand.id]
        : [];
    try {
      await writeClipboardPayload(serializeAudioEqClipboardPayload(copyAudioEqBands(normalized, ids)));
    } catch {
      // Clipboard permission can be unavailable in embedded or headless contexts.
    }
  };

  const handlePaste = async () => {
    if (disabled || !navigator.clipboard) return;
    try {
      const payload = parseAudioEqClipboardPayload(await navigator.clipboard.readText());
      if (!payload) return;
      commitParams(pasteAudioEqClipboardPayload(
        normalized,
        payload,
        payload.scope === 'bands' ? 'append' : 'replace',
      ));
    } catch {
      // Clipboard permission can be unavailable in embedded or headless contexts.
    }
  };

  return (
    <div className={`flex-eq ${compact ? 'compact' : ''}`}>
      <div className="flex-eq-toolbar">
        <div className="flex-eq-segments" role="group" aria-label="EQ preset">
          {PRESET_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={normalized.audible.presetKind === option.value ? 'active' : ''}
              disabled={disabled}
              onClick={() => updatePresetKind(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          value={normalized.audible.phaseMode}
          disabled={disabled}
          aria-label="EQ phase mode"
          onChange={(event) => updatePath('eq.audible.phaseMode', event.currentTarget.value as AudioEqPhaseMode)}
        >
          <option value="zero-latency">Zero</option>
          <option value="natural">Natural</option>
          <option value="linear">Linear</option>
        </select>
        <select
          value={normalized.audible.characterMode}
          disabled={disabled}
          aria-label="EQ character mode"
          onChange={(event) => updatePath('eq.audible.characterMode', event.currentTarget.value as AudioEqCharacterMode)}
        >
          <option value="clean">Clean</option>
          <option value="subtle">Subtle</option>
          <option value="warm">Warm</option>
        </select>
      </div>

      <div className="flex-eq-workflow-row">
        <div className="flex-eq-ab-controls" role="group" aria-label="EQ A/B">
          <button
            type="button"
            className={abState.activeSlot === 'A' ? 'active' : ''}
            disabled={disabled}
            onClick={() => switchABSlot('A')}
          >
            A
          </button>
          <button
            type="button"
            className={abState.activeSlot === 'B' ? 'active' : ''}
            disabled={disabled}
            onClick={() => switchABSlot('B')}
          >
            B
          </button>
          <button type="button" disabled={disabled} onClick={syncActiveABSlot}>Store</button>
        </div>
        <div className="flex-eq-clipboard-controls" role="group" aria-label="EQ clipboard">
          <button type="button" disabled={disabled} onClick={() => void handleCopyCurve()}>Copy</button>
          <button type="button" disabled={disabled || !selectedBand} onClick={() => void handleCopyBands()}>Band</button>
          <button type="button" disabled={disabled} onClick={() => void handlePaste()}>Paste</button>
        </div>
      </div>

      <div className="flex-eq-preset-browser">
        <div className="flex-eq-preset-tools">
          <input
            value={presetQuery}
            disabled={disabled}
            aria-label="Search EQ presets"
            placeholder="Search presets"
            onChange={(event) => setPresetQuery(event.currentTarget.value)}
          />
          <select
            value={presetTagFilter}
            disabled={disabled}
            aria-label="Preset tag filter"
            onChange={(event) => setPresetTagFilter(event.currentTarget.value)}
          >
            <option value="">Tags</option>
            {presetTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <div className="flex-eq-preset-filter" role="group" aria-label="Preset filter">
            {(['all', 'favorites', 'user'] as const).map(filter => (
              <button
                key={filter}
                type="button"
                className={presetFilter === filter ? 'active' : ''}
                disabled={disabled}
                onClick={() => setPresetFilter(filter)}
              >
                {filter === 'all' ? 'All' : filter === 'favorites' ? 'Fav' : 'User'}
              </button>
            ))}
          </div>
          <button type="button" disabled={disabled} onClick={saveCurrentUserPreset}>Save</button>
        </div>
        <div className="flex-eq-preset-list" role="list" aria-label="EQ presets">
          {filteredPresets.slice(0, compact ? 6 : 10).map(preset => (
            <div key={`${preset.source}:${preset.id}`} className="flex-eq-preset-pill" role="listitem">
              <button
                type="button"
                className="flex-eq-preset-main"
                disabled={disabled}
                onClick={() => applyBrowserPreset(preset.id)}
              >
                <span>{preset.name}</span>
                <small>{preset.tags.slice(0, 2).join(' / ') || preset.source}</small>
              </button>
              <button
                type="button"
                className={preset.favorite ? 'active' : ''}
                disabled={disabled}
                aria-label={`Favorite ${preset.name}`}
                onClick={() => toggleBrowserPresetFavorite(preset.id)}
              >
                Fav
              </button>
              {preset.source === 'user' && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Delete ${preset.name}`}
                  onClick={() => deleteBrowserPreset(preset)}
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-eq-generator-row">
        <div className="flex-eq-mode-controls" role="group" aria-label="EQ graph mode">
          <button
            type="button"
            className={graphMode === 'edit' ? 'active' : ''}
            disabled={disabled}
            onClick={() => {
              setGraphMode('edit');
              setSketchPoints([]);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className={graphMode === 'sketch' ? 'active' : ''}
            disabled={disabled}
            onClick={() => {
              setGraphMode(graphMode === 'sketch' ? 'edit' : 'sketch');
              setSketchPoints([]);
            }}
          >
            Sketch
          </button>
          <button
            type="button"
            className={graphMode === 'grab' ? 'active' : ''}
            disabled={disabled || grabPeaks.length === 0}
            onClick={() => setGraphMode(graphMode === 'grab' ? 'edit' : 'grab')}
          >
            Grab
          </button>
        </div>
        <div className="flex-eq-match-controls" role="group" aria-label="EQ match">
          <button type="button" disabled={disabled || !analyzer} className={matchSource ? 'active' : ''} onClick={captureMatchSource}>
            Src
          </button>
          <button type="button" disabled={disabled || !analyzer} className={matchTarget ? 'active' : ''} onClick={captureMatchTarget}>
            Ref
          </button>
          <button type="button" disabled={disabled || !matchSource || !matchTarget} onClick={applyCapturedMatch}>
            Match
          </button>
        </div>
        <div className="flex-eq-analyzer-controls" role="group" aria-label="Spectrum view">
          {ANALYZER_VIEW_OPTIONS.map(option => {
            const currentAnalyzerMode = normalized.display.analyzerMode === 'off'
              ? 'post'
              : normalized.display.analyzerMode;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled || !analyzer}
                className={currentAnalyzerMode === option.value ? 'active' : ''}
                onClick={() => updatePath('eq.display.analyzerMode', option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={stageRef}
        className="flex-eq-stage"
        style={{ minHeight: graphHeight }}
      >
        <canvas
          ref={canvasRef}
          className="flex-eq-canvas"
          aria-label={ariaLabel}
          role="img"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onPointerLeave={() => {
            if (activePointerIdRef.current === null) setHoveredBandId(undefined);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!hoveredBandId) return;
            updateBand(hoveredBandId, { gainDb: 0 });
          }}
        />
      </div>

      <div className="flex-eq-add-row">
        <button type="button" disabled={disabled} onClick={() => addBand('bell', 1000)}>+ Bell</button>
        <button type="button" disabled={disabled} onClick={() => addBand('low-shelf', 120)}>+ Shelf</button>
        <button type="button" disabled={disabled} onClick={() => addBand('low-cut', 35)}>+ Cut</button>
        <label>
          <span>Range</span>
          <select
            value={normalized.display.graphRangeDb}
            disabled={disabled}
            onChange={(event) => updatePath('eq.display.graphRangeDb', Number(event.currentTarget.value))}
          >
            <option value={3}>3 dB</option>
            <option value={6}>6 dB</option>
            <option value={12}>12 dB</option>
            <option value={30}>30 dB</option>
          </select>
        </label>
      </div>

      {selectedBand && (
        <>
        <div className="flex-eq-selected-band">
          {keyframeClipId && effectId && selectedBandAllKeyframeEntries.length > 0 && (
            <MultiKeyframeToggle
              clipId={keyframeClipId}
              entries={selectedBandAllKeyframeEntries}
              dragId={`${keyframeClipId}:effect:${effectId}:eq-band:${selectedBand.id}:all`}
              title="Add all selected band parameter keyframes"
            />
          )}
          <select
            value={selectedBand.type}
            disabled={disabled}
            aria-label="Band type"
            onChange={(event) => updateBand(selectedBand.id, { type: event.currentTarget.value as AudioEqBandType })}
          >
            {BAND_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {renderBandNumericKeyframeToggle(selectedBand, 'frequencyHz', selectedBand.frequencyHz)}
          <DraggableNumber
            value={selectedBand.frequencyHz}
            onChange={(value) => updateBand(selectedBand.id, { frequencyHz: clamp(value, GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ) })}
            defaultValue={selectedBand.frequencyHz}
            min={GRAPH_MIN_FREQUENCY_HZ}
            max={GRAPH_MAX_FREQUENCY_HZ}
            decimals={0}
            suffix=" Hz"
            sensitivity={80}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'gainDb', selectedBand.gainDb)}
          <DraggableNumber
            value={selectedBand.gainDb}
            onChange={(value) => updateBand(selectedBand.id, { gainDb: clamp(value, -60, 60) })}
            defaultValue={0}
            min={-60}
            max={60}
            decimals={1}
            suffix=" dB"
            sensitivity={0.2}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'q', selectedBand.q)}
          <DraggableNumber
            value={selectedBand.q}
            onChange={(value) => updateBand(selectedBand.id, { q: clamp(value, 0.025, 100) })}
            defaultValue={1}
            min={0.025}
            max={100}
            decimals={2}
            sensitivity={0.04}
          />
          <button
            type="button"
            className={selectedBand.enabled ? 'active' : ''}
            disabled={disabled}
            onClick={() => updateBand(selectedBand.id, { enabled: !selectedBand.enabled })}
          >
            On
          </button>
          <button
            type="button"
            className={soloBandIds.includes(selectedBand.id) ? 'active' : ''}
            disabled={disabled}
            onClick={() => toggleSoloBand(selectedBand.id)}
          >
            Solo
          </button>
          <button
            type="button"
            disabled={disabled || normalized.audible.bands.length <= 1}
            onClick={() => commitParams(removeAudioEqBand(normalized, selectedBand.id))}
          >
            x
          </button>
        </div>

        <div className="flex-eq-dynamics-row">
          <button
            type="button"
            className={selectedBand.dynamic?.enabled ? 'active' : ''}
            disabled={disabled}
            onClick={() => updateBandDynamics(selectedBand, { enabled: selectedBand.dynamic?.enabled !== true })}
          >
            Dyn
          </button>
          <select
            value={selectedBand.dynamic?.mode ?? 'compress'}
            disabled={disabled}
            aria-label="Dynamic EQ mode"
            onChange={(event) => updateBandDynamics(selectedBand, { mode: event.currentTarget.value as AudioEqBandDynamics['mode'] })}
          >
            <option value="compress">Compress</option>
            <option value="expand">Expand</option>
          </select>
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.thresholdDb', selectedBand.dynamic?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb)}
          <DraggableNumber
            value={selectedBand.dynamic?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb}
            onChange={(value) => updateBandDynamics(selectedBand, { thresholdDb: clamp(value, -120, 24) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb}
            min={-120}
            max={24}
            decimals={1}
            suffix=" dB"
            sensitivity={0.2}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.rangeDb', selectedBand.dynamic?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb)}
          <DraggableNumber
            value={selectedBand.dynamic?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb}
            onChange={(value) => updateBandDynamics(selectedBand, { rangeDb: clamp(value, 0, 60) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb}
            min={0}
            max={60}
            decimals={1}
            suffix=" dB"
            sensitivity={0.16}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.ratio', selectedBand.dynamic?.ratio ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio)}
          <DraggableNumber
            value={selectedBand.dynamic?.ratio ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio}
            onChange={(value) => updateBandDynamics(selectedBand, { ratio: clamp(value, 1, 100) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio}
            min={1}
            max={100}
            decimals={1}
            suffix=":1"
            sensitivity={0.08}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.attackMs', selectedBand.dynamic?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs)}
          <DraggableNumber
            value={selectedBand.dynamic?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs}
            onChange={(value) => updateBandDynamics(selectedBand, { attackMs: clamp(value, 0.1, 5000) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs}
            min={0.1}
            max={5000}
            decimals={1}
            suffix=" ms"
            sensitivity={0.12}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.releaseMs', selectedBand.dynamic?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs)}
          <DraggableNumber
            value={selectedBand.dynamic?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs}
            onChange={(value) => updateBandDynamics(selectedBand, { releaseMs: clamp(value, 1, 10000) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs}
            min={1}
            max={10000}
            decimals={0}
            suffix=" ms"
            sensitivity={2}
          />
        </div>

        <div className="flex-eq-spectral-row">
          <button
            type="button"
            className={selectedBand.spectralDynamics?.enabled ? 'active' : ''}
            disabled={disabled || selectedBand.type === 'all-pass'}
            onClick={() => updateBandSpectralDynamics(selectedBand, { enabled: selectedBand.spectralDynamics?.enabled !== true })}
          >
            Spec
          </button>
          <select
            value={selectedBand.spectralDynamics?.mode ?? 'compress'}
            disabled={disabled || selectedBand.type === 'all-pass'}
            aria-label="Spectral Dynamics mode"
            onChange={(event) => updateBandSpectralDynamics(selectedBand, { mode: event.currentTarget.value as AudioEqBandSpectralDynamics['mode'] })}
          >
            <option value="compress">Compress</option>
            <option value="expand">Expand</option>
          </select>
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.thresholdDb', selectedBand.spectralDynamics?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb)}
          <DraggableNumber
            value={selectedBand.spectralDynamics?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb}
            onChange={(value) => updateBandSpectralDynamics(selectedBand, { thresholdDb: clamp(value, -120, 24) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb}
            min={-120}
            max={24}
            decimals={1}
            suffix=" dB"
            sensitivity={0.2}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.rangeDb', selectedBand.spectralDynamics?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb)}
          <DraggableNumber
            value={selectedBand.spectralDynamics?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb}
            onChange={(value) => updateBandSpectralDynamics(selectedBand, { rangeDb: clamp(value, 0, 60) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb}
            min={0}
            max={60}
            decimals={1}
            suffix=" dB"
            sensitivity={0.16}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.ratio', selectedBand.spectralDynamics?.ratio ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio)}
          <DraggableNumber
            value={selectedBand.spectralDynamics?.ratio ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio}
            onChange={(value) => updateBandSpectralDynamics(selectedBand, { ratio: clamp(value, 1, 100) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio}
            min={1}
            max={100}
            decimals={1}
            suffix=":1"
            sensitivity={0.08}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.attackMs', selectedBand.spectralDynamics?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs)}
          <DraggableNumber
            value={selectedBand.spectralDynamics?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs}
            onChange={(value) => updateBandSpectralDynamics(selectedBand, { attackMs: clamp(value, 0.1, 5000) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs}
            min={0.1}
            max={5000}
            decimals={1}
            suffix=" ms"
            sensitivity={0.12}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.releaseMs', selectedBand.spectralDynamics?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs)}
          <DraggableNumber
            value={selectedBand.spectralDynamics?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs}
            onChange={(value) => updateBandSpectralDynamics(selectedBand, { releaseMs: clamp(value, 1, 10000) })}
            defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs}
            min={1}
            max={10000}
            decimals={0}
            suffix=" ms"
            sensitivity={2}
          />
          <select
            value={selectedBand.spectralDynamics?.resolution ?? 'balanced'}
            disabled={disabled || selectedBand.type === 'all-pass'}
            aria-label="Spectral Dynamics resolution"
            onChange={(event) => updateBandSpectralDynamics(selectedBand, { resolution: event.currentTarget.value as AudioEqBandSpectralDynamics['resolution'] })}
          >
            <option value="low-latency">Low</option>
            <option value="balanced">Bal</option>
            <option value="mastering">Mast</option>
          </select>
        </div>
        </>
      )}

      <div className="flex-eq-band-strip">
        {normalized.audible.bands.map((band) => {
          const selected = selectedBand?.id === band.id;
          const soloActive = soloBandIds.length > 0;
          const soloed = soloBandIds.includes(band.id);
          return (
            <button
              key={band.id}
              type="button"
              className={`${selected ? 'selected' : ''} ${band.enabled ? '' : 'muted'} ${soloed ? 'soloed' : ''} ${soloActive && !soloed ? 'not-soloed' : ''}`}
              disabled={disabled}
              onClick={() => setSelectedBand(band.id)}
              onDoubleClick={() => commitParams(updateAudioEqBand(normalized, band.id, { gainDb: 0 }))}
            >
              <span>{formatEqualizerFrequency(band.frequencyHz)}</span>
              <strong>{formatSignedDb(band.gainDb)}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}

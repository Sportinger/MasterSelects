import type {
  AnalysisOverviewBandRun,
  AnalysisOverviewLayoutRow,
  AnalysisOverviewRenderModel,
  AnalysisOverviewSeriesBin,
} from './analysisOverviewBins';
import type { AnalysisOverviewLaneKind } from './analysisOverviewTypes';

export type AnalysisOverviewLaneForm = 'blocks' | 'needles' | 'envelope' | 'sparkline' | 'band';

export interface AnalysisOverviewLaneStyle {
  label: string;
  colour: string;
  form: AnalysisOverviewLaneForm;
}

/**
 * Hues validated with the dataviz palette checker against the #0d1117 surface:
 * the envelope trio passes all-pairs CVD separation; the vertical chain passes
 * adjacency with row labels as the required secondary encoding.
 */
export const ANALYSIS_OVERVIEW_LANE_STYLES: Record<
  AnalysisOverviewLaneKind,
  AnalysisOverviewLaneStyle
> = {
  scenes: { label: 'Scenes', colour: '#67e8f9', form: 'blocks' },
  cuts: { label: 'Cuts', colour: '#cbd5e1', form: 'needles' },
  speech: { label: 'Speech', colour: '#9085e9', form: 'band' },
  people: { label: 'People', colour: '#d55181', form: 'band' },
  motion: { label: 'Motion', colour: '#d95926', form: 'envelope' },
  focus: { label: 'Focus', colour: '#3987e5', form: 'envelope' },
  quality: { label: 'Quality', colour: '#199e70', form: 'envelope' },
  audio: { label: 'Audio', colour: '#c98500', form: 'sparkline' },
  markers: { label: 'Markers', colour: '#f0e442', form: 'needles' },
  text: { label: 'Text', colour: '#008300', form: 'band' },
};

const SURFACE = '#0d1117';
const GRID = 'rgba(148, 163, 184, 0.08)';
const SCALE_INK = 'rgba(139, 154, 171, 0.75)';
const BLOCK_INK = 'rgba(226, 232, 240, 0.82)';
const LABEL_FONT = '8px "Segoe UI", system-ui, sans-serif';
/** Scene-block captions under the DOM row label stay hidden to avoid overlap. */
const ROW_LABEL_ZONE = 56;

export interface PaintAnalysisOverviewOptions {
  context: CanvasRenderingContext2D;
  model: AnalysisOverviewRenderModel;
}

interface SeriesSegment {
  from: number;
  to: number;
}

/** Maximal pixel runs with sampled values; envelopes break at coverage gaps. */
function seriesSegments(bins: readonly AnalysisOverviewSeriesBin[]): SeriesSegment[] {
  const segments: SeriesSegment[] = [];
  let from = -1;
  bins.forEach((bin, index) => {
    if (bin.average === null) {
      if (from >= 0) segments.push({ from, to: index - 1 });
      from = -1;
      return;
    }
    if (from < 0) from = index;
  });
  if (from >= 0) segments.push({ from, to: bins.length - 1 });
  return segments;
}

function tracePath(
  context: CanvasRenderingContext2D,
  bins: readonly AnalysisOverviewSeriesBin[],
  segment: SeriesSegment,
  value: (bin: AnalysisOverviewSeriesBin) => number,
  toY: (value: number) => number,
): void {
  for (let index = segment.from; index <= segment.to; index += 1) {
    const x = index + 0.5;
    const y = toY(value(bins[index]));
    if (index === segment.from) context.moveTo(x, y);
    context.lineTo(x, y);
  }
  // A widthless segment still strokes as a round-capped dot.
  if (segment.from === segment.to) {
    context.lineTo(segment.from + 0.52, toY(value(bins[segment.from])));
  }
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
    context.fill();
  } else {
    context.fillRect(x, y, width, height);
  }
}

function paintScenes(
  context: CanvasRenderingContext2D,
  row: AnalysisOverviewLayoutRow,
  model: AnalysisOverviewRenderModel,
): void {
  context.font = LABEL_FONT;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  model.scenes.forEach((scene, index) => {
    const x = scene.startPixel;
    const width = Math.max(1, scene.endPixel - scene.startPixel);
    context.fillStyle = index % 2 === 0
      ? 'rgba(103, 232, 249, 0.17)'
      : 'rgba(103, 232, 249, 0.08)';
    context.fillRect(x, row.top + 1, width, row.height - 2);

    const centre = x + width / 2;
    if (centre < ROW_LABEL_ZONE || width < 14) return;
    const label = scene.label ?? '';
    const short = label.replace(/^scene\s+/i, '');
    const caption = context.measureText(label).width <= width - 6
      ? label
      : context.measureText(short).width <= width - 6 ? short : '';
    if (!caption) return;
    context.fillStyle = BLOCK_INK;
    context.fillText(caption, centre, row.top + row.height / 2 + 0.5);
  });
}

function paintCuts(
  context: CanvasRenderingContext2D,
  row: AnalysisOverviewLayoutRow,
  model: AnalysisOverviewRenderModel,
): void {
  context.fillStyle = GRID;
  context.fillRect(0, row.top + row.height - 1, model.width, 1);
  context.fillStyle = ANALYSIS_OVERVIEW_LANE_STYLES.cuts.colour;
  for (const bin of model.cuts) {
    if (bin.eventCount === 0) continue;
    const density = Math.min(1, Math.log2(bin.eventCount + 1) / 4);
    const needle = Math.max(3, Math.round(row.height * (0.45 + density * 0.55)));
    context.globalAlpha = 0.5 + density * 0.5;
    context.fillRect(bin.index, row.top + row.height - needle, 1, needle);
  }
  context.globalAlpha = 1;
}

function paintMetrics(
  context: CanvasRenderingContext2D,
  row: AnalysisOverviewLayoutRow,
  model: AnalysisOverviewRenderModel,
): void {
  const toY = (value: number) => row.top + 1 + (1 - value) * (row.height - 2);
  context.fillStyle = GRID;
  for (const value of [0, 0.5, 1]) {
    context.fillRect(0, Math.round(toY(value)), model.width, 1);
  }
  if (!model.layout.compact) {
    context.font = LABEL_FONT;
    context.textAlign = 'right';
    context.textBaseline = 'alphabetic';
    context.fillStyle = SCALE_INK;
    context.fillText('100%', model.width - 3, toY(1) + 8);
    context.fillText('0', model.width - 3, toY(0) - 2);
  }

  for (const lane of model.layout.metrics?.lanes ?? []) {
    const bins = model.envelopes.get(lane);
    if (!bins) continue;
    const colour = ANALYSIS_OVERVIEW_LANE_STYLES[lane].colour;
    const segments = seriesSegments(bins);
    context.fillStyle = colour;
    context.globalAlpha = 0.13;
    for (const segment of segments) {
      context.beginPath();
      tracePath(context, bins, segment, (bin) => bin.max ?? 0, toY);
      for (let index = segment.to; index >= segment.from; index -= 1) {
        context.lineTo(index + 0.5, toY(bins[index].min ?? 0));
      }
      context.closePath();
      context.fill();
    }
    context.globalAlpha = 0.92;
    context.strokeStyle = colour;
    context.lineWidth = 1.6;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    for (const segment of segments) {
      context.beginPath();
      tracePath(context, bins, segment, (bin) => bin.average ?? 0, toY);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

function paintSparkline(
  context: CanvasRenderingContext2D,
  row: AnalysisOverviewLayoutRow,
  bins: readonly AnalysisOverviewSeriesBin[],
  colour: string,
): void {
  const baseline = row.top + row.height - 1;
  const toY = (value: number) => row.top + 1 + (1 - value) * (row.height - 2);
  context.fillStyle = colour;
  for (const segment of seriesSegments(bins)) {
    context.globalAlpha = 0.22;
    context.beginPath();
    context.moveTo(segment.from + 0.5, baseline);
    tracePath(context, bins, segment, (bin) => bin.average ?? 0, toY);
    context.lineTo(segment.to + 0.5, baseline);
    context.closePath();
    context.fill();
    context.globalAlpha = 0.9;
    context.strokeStyle = colour;
    context.lineWidth = 1;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    tracePath(context, bins, segment, (bin) => bin.average ?? 0, toY);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function paintMarkers(
  context: CanvasRenderingContext2D,
  row: AnalysisOverviewLayoutRow,
  model: AnalysisOverviewRenderModel,
): void {
  context.fillStyle = ANALYSIS_OVERVIEW_LANE_STYLES.markers.colour;
  for (const bin of model.markers) {
    if (bin.eventCount === 0) continue;
    const confidence = bin.averageScore ?? 0.5;
    const needle = Math.max(3, Math.round((row.height - 2) * (0.45 + confidence * 0.55)));
    context.globalAlpha = Math.min(1, 0.6 + Math.log2(bin.eventCount + 1) * 0.18);
    context.fillRect(bin.index, row.top + row.height - needle - 1, 1, needle);
  }
  context.globalAlpha = 1;
}

function paintBand(
  context: CanvasRenderingContext2D,
  row: AnalysisOverviewLayoutRow,
  runs: readonly AnalysisOverviewBandRun[],
  colour: string,
): void {
  context.fillStyle = colour;
  for (const run of runs) {
    // Overlap count deepens the bar; the tooltip carries exact labels/scores.
    context.globalAlpha = Math.min(0.95, 0.5 + (run.peakCount - 1) * 0.15);
    fillRoundedRect(
      context,
      run.startPixel,
      row.top + 2,
      Math.max(2, run.endPixel - run.startPixel + 1),
      row.height - 5,
      2,
    );
  }
  context.globalAlpha = 1;
}

/**
 * Paints only the visible viewport: every input is already pixel-bounded, so
 * the cost is O(lanes × visible pixels) regardless of source duration.
 */
export function paintAnalysisOverview({ context, model }: PaintAnalysisOverviewOptions): void {
  const { layout, width } = model;
  context.clearRect(0, 0, width, layout.height);
  context.fillStyle = SURFACE;
  context.fillRect(0, 0, width, layout.height);

  context.fillStyle = GRID;
  for (const tick of model.ticks) {
    context.fillRect(Math.round(tick.fraction * width), 0, 1, layout.height);
  }

  if (layout.scenes) paintScenes(context, layout.scenes, model);
  if (layout.cuts) paintCuts(context, layout.cuts, model);
  if (layout.metrics) paintMetrics(context, layout.metrics, model);
  for (const row of layout.presence) {
    if (row.lane === 'audio') {
      if (model.audio) {
        paintSparkline(context, row, model.audio, ANALYSIS_OVERVIEW_LANE_STYLES.audio.colour);
      }
      continue;
    }
    if (row.lane === 'markers') {
      paintMarkers(context, row, model);
      continue;
    }
    paintBand(
      context,
      row,
      model.bands.get(row.lane) ?? [],
      ANALYSIS_OVERVIEW_LANE_STYLES[row.lane].colour,
    );
  }
}

export { getAnalysisOverviewCanvasSize } from './analysisOverviewTypes';

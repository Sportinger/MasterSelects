import { describe, expect, it } from 'vitest';
import {
  buildWaveformLod,
  MAX_WAVEFORM_LOD_COLUMNS,
  normalizeWaveformColumnsForDisplay,
  smoothWaveformColumns,
  type TimelineWaveformPyramid,
} from '../../src/components/timeline/utils/waveformLod';

function createPyramid(): TimelineWaveformPyramid {
  const channel = (values: number[]) => ({
    channelIndex: 0,
    min: values.map((value) => -value),
    max: values,
    rms: values.map((value) => value / 2),
    peak: values,
  });

  return {
    sampleRate: 48_000,
    duration: 8,
    levels: [
      {
        samplesPerBucket: 128,
        bucketDuration: 128 / 48_000,
        bucketCount: 8,
        channels: [channel([0.1, 0.2, 0.35, 0.55, 0.75, 0.6, 0.4, 0.2])],
      },
      {
        samplesPerBucket: 2_048,
        bucketDuration: 2_048 / 48_000,
        bucketCount: 8,
        channels: [channel([0.15, 0.22, 0.4, 0.5, 0.65, 0.54, 0.35, 0.18])],
      },
    ],
  };
}

describe('buildWaveformLod', () => {
  it('uses pyramid data and selects a detailed level at high timeline zoom', () => {
    const result = buildWaveformLod({
      pyramid: createPyramid(),
      width: 800,
      inPoint: 0,
      outPoint: 2,
      naturalDuration: 8,
      pixelsPerSecond: 400,
    });

    expect(result?.source).toBe('pyramid');
    expect(result?.selectedSamplesPerBucket).toBe(128);
    expect(result?.columns).toHaveLength(800);
    expect(result?.columns.some((column) => column.max > 0)).toBe(true);
    expect(result?.columns.some((column) => column.min < 0)).toBe(true);
  });

  it('uses coarser pyramid levels when zoomed out', () => {
    const result = buildWaveformLod({
      pyramid: createPyramid(),
      width: 320,
      inPoint: 0,
      outPoint: 8,
      naturalDuration: 8,
      pixelsPerSecond: 40,
    });

    expect(result?.source).toBe('pyramid');
    expect(result?.selectedSamplesPerBucket).toBe(2_048);
  });

  it('uses explicit timeline zoom to keep capped pyramid renders on high-detail levels', () => {
    const result = buildWaveformLod({
      pyramid: createPyramid(),
      width: MAX_WAVEFORM_LOD_COLUMNS + 2_000,
      inPoint: 0,
      outPoint: 8,
      naturalDuration: 8,
      pixelsPerSecond: 2_000,
    });

    expect(result?.source).toBe('pyramid');
    expect(result?.selectedSamplesPerBucket).toBe(128);
    expect(result?.columns).toHaveLength(MAX_WAVEFORM_LOD_COLUMNS);
    expect(result?.pixelsPerSecond).toBe(2_000);
  });

  it('interpolates legacy thumbnail data only when zoom exceeds stored resolution', () => {
    const result = buildWaveformLod({
      waveform: [0, 1],
      width: 5,
      inPoint: 0,
      outPoint: 1,
      naturalDuration: 1,
    });

    expect(result?.source).toBe('legacy-interpolated');
    expect(result?.columns.map((column) => column.peak)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('bounds legacy fallback columns at deep zoom while preserving the visible envelope', () => {
    const result = buildWaveformLod({
      waveform: [0, 0.25, 0.5, 0.75, 1],
      width: MAX_WAVEFORM_LOD_COLUMNS + 12_000,
      inPoint: 0,
      outPoint: 1,
      naturalDuration: 1,
      pixelsPerSecond: 48_000,
    });

    expect(result?.source).toBe('legacy-interpolated');
    expect(result?.columns).toHaveLength(MAX_WAVEFORM_LOD_COLUMNS);
    expect(result?.columns[0].peak).toBe(0);
    expect(result?.columns.at(-1)?.peak).toBe(1);
    expect(result?.columns.every((column) => (
      column.peak >= 0
      && column.peak <= 1
      && column.rms >= 0
      && column.rms <= 1
      && column.min >= -1
      && column.max <= 1
    ))).toBe(true);
    expect(result?.pixelsPerSecond).toBe(48_000);
  });

  it('aggregates legacy thumbnail data when zoomed out', () => {
    const result = buildWaveformLod({
      waveform: [0, 0.5, 1, 0.25],
      width: 2,
      inPoint: 0,
      outPoint: 1,
      naturalDuration: 1,
    });

    expect(result?.source).toBe('legacy-aggregate');
    expect(result?.columns.map((column) => column.peak)).toEqual([0.5, 1]);
  });

  it('uses per-channel legacy thumbnail data when a channel is requested', () => {
    const result = buildWaveformLod({
      waveform: [1, 1, 1, 1],
      waveformChannels: [
        [0, 0.25, 0.5, 0.25],
        [0.75, 0.5, 0.25, 0],
      ],
      channelIndex: 1,
      width: 2,
      inPoint: 0,
      outPoint: 1,
      naturalDuration: 1,
    });

    expect(result?.source).toBe('legacy-aggregate');
    expect(result?.columns.map((column) => column.peak)).toEqual([0.75, 0.25]);
  });

  it('smooths legacy columns without changing their count', () => {
    const columns = [
      { min: 0, max: 0, rms: 0, peak: 0 },
      { min: -1, max: 1, rms: 1, peak: 1 },
      { min: 0, max: 0, rms: 0, peak: 0 },
    ];

    const smoothed = smoothWaveformColumns(columns, 1, 1);

    expect(smoothed).toHaveLength(columns.length);
    expect(smoothed[0].peak).toBeGreaterThan(0);
    expect(smoothed[1].peak).toBeLessThan(1);
  });

  it('normalizes quiet display columns with bounded soft gain', () => {
    const normalized = normalizeWaveformColumnsForDisplay([
      { min: -0.02, max: 0.02, rms: 0.01, peak: 0.02 },
      { min: -0.03, max: 0.03, rms: 0.015, peak: 0.03 },
    ], {
      targetPeak: 0.72,
      minReferencePeak: 0.03,
      maxGain: 20,
    });

    expect(normalized[0].peak).toBeGreaterThan(0.2);
    expect(normalized[1].peak).toBeLessThanOrEqual(1);
  });

  it('normalizes pathological display columns to finite bounded values', () => {
    const normalized = normalizeWaveformColumnsForDisplay([
      { min: -20, max: 20, rms: 20, peak: 20 },
      { min: Number.NaN, max: Number.POSITIVE_INFINITY, rms: -2, peak: Number.NEGATIVE_INFINITY },
      { min: 0, max: 0, rms: 0, peak: 0 },
    ], {
      targetPeak: Number.POSITIVE_INFINITY,
      minReferencePeak: 0,
      maxGain: Number.POSITIVE_INFINITY,
    });

    expect(normalized).toHaveLength(3);
    for (const column of normalized) {
      expect(Number.isFinite(column.min)).toBe(true);
      expect(Number.isFinite(column.max)).toBe(true);
      expect(Number.isFinite(column.rms)).toBe(true);
      expect(Number.isFinite(column.peak)).toBe(true);
      expect(column.min).toBeGreaterThanOrEqual(-1);
      expect(column.max).toBeLessThanOrEqual(1);
      expect(column.rms).toBeGreaterThanOrEqual(0);
      expect(column.rms).toBeLessThanOrEqual(1);
      expect(column.peak).toBeGreaterThanOrEqual(0);
      expect(column.peak).toBeLessThanOrEqual(1);
    }
  });
});

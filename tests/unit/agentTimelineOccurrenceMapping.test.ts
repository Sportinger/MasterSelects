import { describe, expect, it } from 'vitest';
import { buildOccurrenceMappingIndex } from '../../src/services/agentTimeline/mapping/occurrenceMappingIndex';
import {
  projectCompositionInterval,
  projectCompositionPoint,
  projectSourceInterval,
  projectSourcePoint,
} from '../../src/services/agentTimeline/mapping/occurrenceMappingQueries';
import type { SourceOccurrenceMappingInput } from '../../src/types/agentTimeline/occurrenceMapping';

function occurrence(overrides: Partial<SourceOccurrenceMappingInput> = {}): SourceOccurrenceMappingInput {
  return {
    sourceId: 'source-a',
    clipId: 'clip-a',
    compositionPath: ['root'],
    sourceRange: { start: 0, end: 10 },
    pieces: [{
      compositionStart: 0,
      compositionEnd: 10,
      sourceStart: 0,
      sourceRateStart: 1,
    }],
    ...overrides,
  };
}

describe('agent timeline occurrence mapping', () => {
  it('returns every repeated source occurrence and keeps IDs stable across input order', () => {
    const first = occurrence({ clipId: 'first' });
    const second = occurrence({
      clipId: 'second',
      pieces: [{ compositionStart: 20, compositionEnd: 30, sourceStart: 0, sourceRateStart: 1 }],
    });
    const forward = buildOccurrenceMappingIndex({ stateHash: 'state-1', occurrences: [first, second] });
    const reordered = buildOccurrenceMappingIndex({ stateHash: 'state-1', occurrences: [second, first] });

    expect(forward.occurrences).toEqual(reordered.occurrences);
    expect(projectSourcePoint(forward, { sourceId: 'source-a', sourceTime: 2 })
      .map(item => item.compositionTime)).toEqual([2, 22]);
    expect(new Set(forward.occurrences.map(item => item.occurrenceId)).size).toBe(2);
  });

  it('maps reverse playback and clips projections to the source trim', () => {
    const index = buildOccurrenceMappingIndex({
      stateHash: 'reverse',
      occurrences: [occurrence({
        sourceRange: { start: 2, end: 8 },
        pieces: [{
          compositionStart: 5,
          compositionEnd: 15,
          sourceStart: 10,
          sourceRateStart: -1,
        }],
      })],
    });

    expect(index.segments).toHaveLength(1);
    expect(index.segments[0]).toMatchObject({
      direction: 'reverse',
      compositionRange: { start: 7, end: 13 },
      sourceRange: { start: 2, end: 8 },
    });
    expect(projectSourcePoint(index, { sourceId: 'source-a', sourceTime: 6 })[0])
      .toMatchObject({ compositionTime: 9, direction: 'reverse', localSpeed: -1 });
    expect(projectSourcePoint(index, { sourceId: 'source-a', sourceTime: 8 })).toEqual([]);
  });

  it('solves a linear speed ramp analytically in both directions', () => {
    const index = buildOccurrenceMappingIndex({
      stateHash: 'ramp',
      occurrences: [occurrence({
        sourceRange: { start: 0, end: 5 },
        pieces: [{
          compositionStart: 10,
          compositionEnd: 12,
          sourceStart: 0,
          sourceRateStart: 1,
          sourceRateEnd: 3,
        }],
      })],
    });

    expect(index.segments).toHaveLength(1);
    expect(projectSourcePoint(index, { sourceId: 'source-a', sourceTime: 1.5 })[0])
      .toMatchObject({ compositionTime: 11, localSpeed: 2 });
    expect(projectCompositionPoint(index, { compositionPath: ['root'], compositionTime: 11 })[0])
      .toMatchObject({ sourceTime: 1.5, localSpeed: 2 });
  });

  it('splits a speed ramp at its direction change', () => {
    const index = buildOccurrenceMappingIndex({
      stateHash: 'direction-switch',
      occurrences: [occurrence({
        sourceRange: { start: 0, end: 2 },
        pieces: [{
          compositionStart: 0,
          compositionEnd: 2,
          sourceStart: 1,
          sourceRateStart: -1,
          sourceRateEnd: 1,
        }],
      })],
    });

    expect(index.segments.map(segment => ({
      range: segment.compositionRange,
      direction: segment.direction,
    }))).toEqual([
      { range: { start: 0, end: 1 }, direction: 'reverse' },
      { range: { start: 1, end: 2 }, direction: 'forward' },
    ]);
    expect(projectSourcePoint(index, { sourceId: 'source-a', sourceTime: .5 })
      .map(item => item.compositionTime)).toEqual([1]);
    expect(projectSourcePoint(index, { sourceId: 'source-a', sourceTime: .75 }))
      .toHaveLength(2);
  });

  it('projects speed-zero points as held ranges with explicit half-open policy', () => {
    const index = buildOccurrenceMappingIndex({
      stateHash: 'hold',
      occurrences: [occurrence({
        sourceRange: { start: 0, end: 10 },
        pieces: [{
          compositionStart: 4,
          compositionEnd: 7,
          sourceStart: 3,
          sourceRateStart: 0,
        }],
      })],
    });

    expect(projectSourcePoint(index, { sourceId: 'source-a', sourceTime: 3 })[0])
      .toMatchObject({ kind: 'hold', compositionRange: { start: 4, end: 7 }, localSpeed: 0 });
    expect(projectSourceInterval(index, {
      sourceId: 'source-a',
      sourceRange: { start: 3, end: 4 },
    })[0]).toMatchObject({ kind: 'hold', compositionRange: { start: 4, end: 7 } });
    expect(projectSourceInterval(index, {
      sourceId: 'source-a',
      sourceRange: { start: 2, end: 3 },
    })).toEqual([]);
  });

  it('indexes nested paths and maps clipped composition intervals without sampling', () => {
    const index = buildOccurrenceMappingIndex({
      stateHash: 'nested',
      occurrences: [occurrence({
        compositionPath: ['root', 'nested-a', 'nested-b'],
        pieces: [
          { compositionStart: 30, compositionEnd: 34, sourceStart: 0, sourceRateStart: 1 },
          { compositionStart: 34, compositionEnd: 36, sourceStart: 4, sourceRateStart: 2 },
        ],
      })],
    });
    const projected = projectCompositionInterval(index, {
      compositionPath: ['root', 'nested-a', 'nested-b'],
      compositionRange: { start: 32, end: 35 },
    });

    expect(projected).toHaveLength(2);
    expect(projected.map(item => item.compositionRange)).toEqual([
      { start: 32, end: 34 },
      { start: 34, end: 35 },
    ]);
    expect(projected.map(item => item.sourceRange)).toEqual([
      { start: 2, end: 4 },
      { start: 4, end: 6 },
    ]);
    expect(projectCompositionPoint(index, {
      compositionPath: ['root', 'other'],
      compositionTime: 33,
    })).toEqual([]);
  });

  it('splits source intervals at piece and direction boundaries', () => {
    const index = buildOccurrenceMappingIndex({
      stateHash: 'intervals',
      occurrences: [occurrence({
        pieces: [
          { compositionStart: 0, compositionEnd: 4, sourceStart: 0, sourceRateStart: 1 },
          { compositionStart: 4, compositionEnd: 8, sourceStart: 8, sourceRateStart: -1 },
        ],
      })],
    });
    const projected = projectSourceInterval(index, {
      sourceId: 'source-a',
      sourceRange: { start: 2, end: 6 },
    });

    expect(projected.map(item => ({
      direction: item.direction,
      compositionRange: item.compositionRange,
    }))).toEqual([
      { direction: 'forward', compositionRange: { start: 2, end: 4 } },
      { direction: 'reverse', compositionRange: { start: 6, end: 8 } },
    ]);
    expect(projected.every(item => item.mappingSegmentId.length > 4)).toBe(true);
  });
});

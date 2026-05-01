import { describe, expect, it } from 'vitest';
import { resolveExportRange } from '../../src/components/export/exportRange';

describe('resolveExportRange', () => {
  it('uses an out marker as the export end when In/Out export is enabled', () => {
    expect(resolveExportRange({ duration: 60, inPoint: null, outPoint: 12.5 }, true)).toEqual({
      startTime: 0,
      endTime: 12.5,
    });
  });

  it('uses both in and out markers when present', () => {
    expect(resolveExportRange({ duration: 60, inPoint: 5, outPoint: 12.5 }, true)).toEqual({
      startTime: 5,
      endTime: 12.5,
    });
  });

  it('ignores markers when In/Out export is disabled', () => {
    expect(resolveExportRange({ duration: 60, inPoint: 5, outPoint: 12.5 }, false)).toEqual({
      startTime: 0,
      endTime: 60,
    });
  });

  it('clamps marker values to a valid timeline range', () => {
    expect(resolveExportRange({ duration: 60, inPoint: -10, outPoint: 120 }, true)).toEqual({
      startTime: 0,
      endTime: 60,
    });
  });
});

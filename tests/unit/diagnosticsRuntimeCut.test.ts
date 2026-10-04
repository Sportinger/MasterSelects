import { describe, expect, it } from 'vitest';
import { parseRuntimeSince } from '../../functions/lib/diagnosticsAdmin';

const now = Date.parse('2026-10-04T12:00:00.000Z');
const url = (since?: string) => `https://www.masterselects.com/api/admin/stats-brief${since ? `?since=${encodeURIComponent(since)}` : ''}`;

describe('stats-brief operations cut', () => {
  it('accepts a recent ISO cut and normalizes it', () => {
    expect(parseRuntimeSince(url('2026-10-04T10:15:30Z'), now)).toBe('2026-10-04T10:15:30.000Z');
    expect(parseRuntimeSince(url('2026-10-01T00:00:00.000Z'), now)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('ignores missing, malformed, future and too old cuts', () => {
    expect(parseRuntimeSince(url(), now)).toBeNull();
    expect(parseRuntimeSince(url('2026-10-04'), now)).toBeNull();
    expect(parseRuntimeSince(url("2026-10-04T10:00:00Z' OR 1=1"), now)).toBeNull();
    expect(parseRuntimeSince(url('2026-10-05T00:00:00.000Z'), now)).toBeNull();
    expect(parseRuntimeSince(url('2026-09-01T00:00:00.000Z'), now)).toBeNull();
  });
});

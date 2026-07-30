import { describe, expect, it } from 'vitest';
import { resolveRequestedExportMode } from '../../src/engine/export/exportModeSelection';

describe('export mode selection', () => {
  it('keeps fast export as the default', () => {
    expect(resolveRequestedExportMode(undefined)).toBe('fast');
    expect(resolveRequestedExportMode('fast')).toBe('fast');
  });

  it('uses precise mode only when explicitly requested', () => {
    expect(resolveRequestedExportMode('precise')).toBe('precise');
  });
});

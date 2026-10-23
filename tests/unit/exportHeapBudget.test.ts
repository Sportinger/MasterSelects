import { describe, expect, it } from 'vitest';
import { getExportHeapBudgetBytes } from '../../src/services/timeline/runtimeCoordinatorPolicyCatalog';

const GIB = 1024 ** 3;

describe('export heap budget', () => {
  it('grows with the reported RAM, so long audio exports are not refused at 1.5 GiB', () => {
    expect(getExportHeapBudgetBytes(null)).toBe(1.5 * GIB);
    expect(getExportHeapBudgetBytes(2)).toBe(1.5 * GIB);
    expect(getExportHeapBudgetBytes(4)).toBe(2 * GIB);
    // Chrome reports at most 8: two 48-minute stereo PCM copies (~2.1 GB) fit.
    expect(getExportHeapBudgetBytes(8)).toBe(4 * GIB);
    expect(getExportHeapBudgetBytes(8)).toBeGreaterThan(2114270032);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isSupportedScanImage,
  mergeScanSourceFiles,
  scanSourceKey,
} from '../../src/services/photogrammetry/scanSourceAnalysis';

function file(name: string, sizeSeed = 'content', lastModified = 10): File {
  return new File([sizeSeed], name, { lastModified });
}

describe('photogrammetry source planning', () => {
  it('recognizes browser image sources including phone formats', () => {
    expect(isSupportedScanImage(file('frame.jpg'))).toBe(true);
    expect(isSupportedScanImage(file('frame.HEIC'))).toBe(true);
    expect(isSupportedScanImage(file('notes.txt'))).toBe(false);
  });

  it('deduplicates a capture set without retaining unsupported files', () => {
    const existing = file('frame-01.jpg');
    const duplicate = file('frame-01.jpg');
    const next = file('frame-02.png', 'next');
    const result = mergeScanSourceFiles([existing], [duplicate, next, file('readme.md')]);

    expect(result.files.map((entry) => entry.name)).toEqual(['frame-02.png']);
    expect(result.duplicates).toBe(1);
    expect(result.unsupported).toBe(1);
    expect(scanSourceKey(existing)).toBe(scanSourceKey(duplicate));
  });
});

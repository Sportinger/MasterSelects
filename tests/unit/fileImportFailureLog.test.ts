import { beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../src/services/logger';
import { reportImportFailure } from '../../src/stores/mediaStore/slices/fileImport/log';

describe('file import failure logging', () => {
  beforeEach(() => {
    Logger.clear();
  });

  it('logs a media item replaced during its import as a stop, not an error', () => {
    const real = reportImportFailure('clip.mp4', new DOMException('Media import target changed', 'AbortError'));

    expect(real).toBe(false);
    expect(Logger.errors()).toHaveLength(0);
  });

  it('still logs real import failures as errors', () => {
    const real = reportImportFailure('clip.mp4', new Error('Unsupported codec'));

    expect(real).toBe(true);
    expect(Logger.search('Import failed: clip.mp4').filter((entry) => entry.level === 'ERROR')).toHaveLength(1);
  });
});

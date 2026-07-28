import { describe, expect, it } from 'vitest';
import {
  handleAddClipSegment,
} from '../../src/services/aiTools/handlers/clips/addSegment';

describe('addClipSegment preflight', () => {
  it('rejects sub-frame ranges before creating any media clips', async () => {
    await expect(handleAddClipSegment({
      mediaFileId: 'unused',
      trackId: 'unused',
      startTime: 0,
      inPoint: 1,
      outPoint: 1.02,
    })).resolves.toEqual({
      success: false,
      error: 'Clip segment duration must be at least 0.04s',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { prioritizeLinkedMedia } from '../../src/services/project/repository/transaction/linkedMediaPriority';
import type { TimelineClip } from '../../src/types/timeline';

describe('linked media connection priority', () => {
  it('connects current nested picture and audio before future clips and unrelated media', () => {
    const clip = (id: string, startTime: number) => ({ startTime, duration: 10, inPoint: 0,
      source: { mediaFileId: id } } as TimelineClip);
    const items = ['unused', 'later', 'audio', 'nested', 'nested-later'].map(id => ({ id }));
    const nested = { startTime: 10, duration: 20, inPoint: 30, speed: 2,
      nestedClips: [clip('nested-later', 80), clip('nested', 35)] } as TimelineClip;
    expect(prioritizeLinkedMedia(items, [clip('later', 100), clip('audio', 10), nested], 13).map(item => item.id))
      .toEqual(['audio', 'nested', 'later', 'nested-later', 'unused']);
    expect(items[0].id).toBe('unused');
  });
});

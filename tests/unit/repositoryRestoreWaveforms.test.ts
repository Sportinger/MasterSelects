import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { carryDerivedClipWaveforms } from '../../src/services/project/repository/transaction/editorTimelineRestore';

const clip = (patch: Partial<TimelineClip>) => ({ id: 'c', mediaFileId: 'm', ...patch }) as TimelineClip;

describe('repository restore keeps media-derived clip fields', () => {
  it('reuses the waveform of the same clip on the same media and nothing else', () => {
    const before = [clip({ waveform: [0.1, 0.2], waveformChannels: [[0.1]] as never }), clip({ id: 'nested', isComposition: true, waveform: [0.5] })];
    const [kept, nested, other, moved] = carryDerivedClipWaveforms(before, [clip({}), clip({ id: 'nested', isComposition: true }),
      clip({ id: 'new' }), clip({ id: 'c', mediaFileId: 'other' })]);
    expect(kept.waveform).toEqual([0.1, 0.2]);
    expect(kept.waveformChannels).toEqual([[0.1]]);
    expect(nested.waveform).toBeUndefined();
    expect(other.waveform).toBeUndefined();
    expect(moved.waveform).toBeUndefined();
  });

  it('also keeps the media-projected transcript and analysis, and never overrides restored values', () => {
    const transcript = [{ id: 'w' }] as never;
    const before = [clip({ transcript, transcriptStatus: 'ready', analysisStatus: 'ready' })];
    const [kept] = carryDerivedClipWaveforms(before, [clip({})]);
    expect(kept.transcript).toBe(transcript);
    expect(kept.transcriptStatus).toBe('ready');
    const [own] = carryDerivedClipWaveforms(before, [clip({ transcriptStatus: 'none' })]);
    expect(own.transcriptStatus).toBe('none');
    const unchanged = clip({});
    expect(carryDerivedClipWaveforms([], [unchanged])[0]).toBe(unchanged);
  });
});

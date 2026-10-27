import { describe, expect, it } from 'vitest';

import {
  formatPhoneCaptionTime, groupPhoneCaptionEvents, listPhoneSpeechSources, validatePhoneCaptionWord,
} from '../../src/components/mobileSkin/captions/phoneCaptionModel';
import {
  matchPhoneCaptionPreset, PHONE_CAPTION_PRESETS, readPhoneCaptionStyle,
} from '../../src/components/mobileSkin/captions/phoneCaptionStyles';
import { phoneTranscriptionReadiness } from '../../src/components/mobileSkin/captions/phoneTranscription';
import { cloneDefaultCaptionProperties } from '../../src/services/captions/captionDefaults';
import type { CaptionTimelineTranscriptEvent } from '../../src/services/captions/captionTimelineTranscript';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const word = (id: string, start: number, end: number, source = 'v'): CaptionTimelineTranscriptEvent => ({
  kind: 'word', key: `w:${id}`, sourceClipId: source, sourceStart: start, sourceEnd: end, text: id, timelineStart: start, timelineEnd: end, wordId: id,
});

describe('phone caption groups', () => {
  it('groups like the renderer: max words, new caption after a pause or a source change, pauses ignored', () => {
    const events: CaptionTimelineTranscriptEvent[] = [
      word('a', 0, 0.2), word('b', 0.25, 0.4), word('c', 0.45, 0.6),
      { kind: 'pause', key: 'p', sourceClipId: 'v', timelineStart: 0.6, timelineEnd: 2 },
      word('d', 2, 2.2), word('e', 2.25, 2.4, 'other'),
    ];
    const groups = groupPhoneCaptionEvents(events, 2, 0.8);
    expect(groups.map((group) => group.words.map((entry) => entry.text))).toEqual([['a', 'b'], ['c'], ['d'], ['e']]);
    expect(groups[0]).toMatchObject({ start: 0, end: 0.4 });
    expect(groupPhoneCaptionEvents(events, 20, 5).map((group) => group.words.length)).toEqual([4, 1]);
  });

  it('accepts exactly one word per timing slot', () => {
    expect(validatePhoneCaptionWord(' Hallo ')).toBeNull();
    expect(validatePhoneCaptionWord('')).toMatch(/Cut word/);
    expect(validatePhoneCaptionWord('two words')).toMatch(/One word/);
  });

  it('formats minutes and tenths', () => {
    expect(formatPhoneCaptionTime(0)).toBe('0:00.0');
    expect(formatPhoneCaptionTime(65.25)).toBe('1:05.3');
  });
});

describe('phone speech sources', () => {
  it('lists a linked video and its sound once, with the transcript state of either', () => {
    const tracks = [createMockTrack({ id: 'v1', type: 'video' }), createMockTrack({ id: 'a1', type: 'audio' })];
    const video = createMockClip({ id: 'vid', name: 'Interview', trackId: 'v1', startTime: 1, duration: 3, linkedClipId: 'aud', source: { type: 'video' } as TimelineClip['source'] });
    const audio = createMockClip({ id: 'aud', trackId: 'a1', startTime: 1, duration: 3, linkedClipId: 'vid', source: { type: 'audio' } as TimelineClip['source'], transcriptStatus: 'transcribing', transcriptProgress: 40 });
    const music = createMockClip({ id: 'mus', name: 'Music', trackId: 'a1', startTime: 5, duration: 2, source: { type: 'audio' } as TimelineClip['source'] });
    const sources = listPhoneSpeechSources([audio, video, music], tracks);
    expect(sources.map((source) => [source.clipId, source.status, source.progress])).toEqual([['vid', 'transcribing', 40], ['mus', 'none', 0]]);
  });
});

describe('phone caption styles', () => {
  const captionClip = (): TimelineClip => createMockClip({
    id: 'cap', captionProperties: cloneDefaultCaptionProperties(),
    textProperties: { fontSize: 64, color: '#ffffff', strokeEnabled: true, strokeColor: '#000000', strokeWidth: 4, fontWeight: 700, shadowEnabled: false } as TimelineClip['textProperties'],
  });

  it('reads the editor defaults', () => {
    expect(readPhoneCaptionStyle(captionClip())).toMatchObject({
      fontSize: 64, color: '#ffffff', uppercase: false, outline: true, background: false, highlight: true,
      highlightMode: 'active-word', highlightStyle: 'text', highlightColor: '#ffe45c', positionY: 84, wordsPerCaption: 5, maxLines: 2, sourceClipId: null,
    });
  });

  it('recognises the Clean preset on a default caption and gives every preset absolute values', () => {
    expect(matchPhoneCaptionPreset(captionClip())).toBe('clean');
    for (const preset of PHONE_CAPTION_PRESETS) {
      expect(Object.keys(preset.update).toSorted()).toEqual(['background', 'highlight', 'textStyle', 'textTransform']);
      expect((preset.update.highlight as Record<string, unknown>).enabled).toBeTypeOf('boolean');
    }
  });
});

describe('phone transcription readiness', () => {
  it('needs an account for hosted providers only', () => {
    expect(phoneTranscriptionReadiness('local', false).kind).toBe('ready');
    expect(phoneTranscriptionReadiness('hybrid', true).kind).toBe('ready');
    const blocked = phoneTranscriptionReadiness('hybrid', false);
    expect(blocked.kind).toBe('needs-account');
    expect(blocked.kind === 'needs-account' && blocked.reason).toMatch(/On this phone/);
  });
});

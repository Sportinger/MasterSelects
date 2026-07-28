import { describe, expect, it } from 'vitest';
import {
  assignEventsToScene,
  buildAnalysisSceneTranscriptTurns,
  findActiveAnalysisSceneWord,
  rangesOverlap,
  type AnalysisSceneSpeakerTurn,
  type AnalysisSceneTranscriptWord,
} from '../../src/components/panels/properties/analysisWorkspace/analysisSceneViewModel';

describe('analysis scene view model', () => {
  it('uses half-open overlap and never mutates source event order', () => {
    const scene = { start: 10, end: 20 };
    const events = [{ id: 'after', start: 20, end: 22 }, { id: 'inside', start: 12, end: 13 }, { id: 'before', start: 8, end: 10 }];
    expect(rangesOverlap(scene, events[0])).toBe(false);
    expect(assignEventsToScene(scene, events).map(event => event.id)).toEqual(['inside']);
    expect(events.map(event => event.id)).toEqual(['after', 'inside', 'before']);
  });

  it('assigns words to overlapping speaker turns without clipping source words', () => {
    const words: AnalysisSceneTranscriptWord[] = [
      { id: 'w1', text: 'Hello', start: 10, end: 10.5, speakerId: 's1' },
      { id: 'w2', text: 'there', start: 11, end: 11.5, speakerId: 's1' },
      { id: 'edge', text: 'later', start: 20, end: 20.5 },
    ];
    const turns: AnalysisSceneSpeakerTurn[] = [{ id: 't1', start: 9, end: 12, speakerId: 's1', speakerLabel: 'Ava', state: 'active' }];
    const result = buildAnalysisSceneTranscriptTurns({ start: 10, end: 20 }, words, turns);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ speakerLabel: 'Ava', state: 'active' });
    expect(result[0].words.map(word => word.id)).toEqual(['w1', 'w2']);
    expect(words[0]).toMatchObject({ start: 10, end: 10.5 });
  });

  it('highlights an active word with half-open timing', () => {
    const words: AnalysisSceneTranscriptWord[] = [{ id: 'w', text: 'Word', start: 1, end: 2 }];
    expect(findActiveAnalysisSceneWord(words, 1.5)?.id).toBe('w');
    expect(findActiveAnalysisSceneWord(words, 2)).toBeUndefined();
  });
});

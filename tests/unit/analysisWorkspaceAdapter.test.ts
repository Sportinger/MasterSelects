import { describe, expect, it } from 'vitest';
import { buildAnalysisWorkspaceViewModel } from '../../src/components/panels/properties/analysisWorkspace/analysisWorkspaceAdapter';

describe('analysis workspace adapter', () => {
  it('keeps all data in source time and excludes adjoining half-open ranges', () => {
    const result = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 10, outPoint: 20 },
      sceneSegments: [
        { id: 'first', text: 'First setup', start: 10, end: 15 },
        { id: 'second', text: 'Second setup', start: 15, end: 20 },
      ],
      transcript: [
        { id: 'first-word', text: 'First', start: 14.5, end: 15, speaker: 'Ava' },
        { id: 'second-word', text: 'Second', start: 15, end: 15.5, speaker: 'Ben' },
      ],
    });

    expect(result.overview).toMatchObject({ startTime: 10, duration: 10 });
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0].transcript.map(word => word.id)).toEqual(['first-word']);
    expect(result.scenes[1].transcript.map(word => word.id)).toEqual(['second-word']);
  });

  it('derives shot fallback scenes from cut points when descriptions are absent', () => {
    const result = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 12 },
      cuts: [
        { timestamp: 8, frameNumber: 80, score: .8, changedRatio: .8, meanPixelDifference: .8, histogramDifference: .8, edgeChangeRatio: .8, motionCompensatedDifference: .8, confidence: .8 },
        { timestamp: 4, frameNumber: 40, score: .9, changedRatio: .9, meanPixelDifference: .9, histogramDifference: .9, edgeChangeRatio: .9, motionCompensatedDifference: .9, confidence: .9 },
      ],
    });

    expect(result.scenes.map(scene => scene.range)).toEqual([{ start: 0, end: 4 }, { start: 4, end: 8 }, { start: 8, end: 12 }]);
    expect(result.scenes.every(scene => scene.boundarySource === 'shot-fallback')).toBe(true);
    expect(result.overview.lanes.cuts).toHaveLength(2);
  });

  it('maps consecutive speakers and overlapping face appearances into a scene', () => {
    const result = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 10 },
      analysis: {
        sampleInterval: 1000,
        frames: [],
        faceAnalysis: {
          schemaVersion: 1, modelVersion: 'test', detector: 'YuNet', recognizer: 'SFace', backend: 'wasm', observationCount: 2,
          people: [{ id: 'ava', label: 'Ava', firstSeen: 1, lastSeen: 5, sampleCount: 2, averageConfidence: .92, maxConfidence: .95, appearances: [{ start: 1, end: 5 }] }],
        },
      },
      transcript: [
        { id: 'one', text: 'Hello', start: 1, end: 1.2, speaker: 'Ava', confidence: .9 },
        { id: 'two', text: 'there', start: 1.3, end: 1.5, speaker: 'Ava', confidence: .9 },
        { id: 'three', text: 'Hi', start: 2, end: 2.2, speaker: 'Ben' },
      ],
    });

    const scene = result.scenes[0];
    expect(scene.people).toMatchObject([{
      id: 'ava',
      sampleCount: 2,
      presence: { start: 1, end: 5 },
      appearances: [{ start: 1, end: 5 }],
    }]);
    expect(scene.speakerTurns).toMatchObject([
      { speakerLabel: 'Ava', state: 'active', start: 1, end: 1.5 },
      { speakerLabel: 'Ben', state: 'offscreen', start: 2, end: 2.2 },
    ]);
    expect(result.overview.lanes.speech).toHaveLength(3);
    expect(result.overview.lanes.people).toHaveLength(1);
  });

  it('fills every overview lane from available data while declaring unavailable audio honestly', () => {
    const result = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 2 },
      analysis: { sampleInterval: 1000, frames: [{ timestamp: 0, motion: .4, globalMotion: .5, localMotion: .1, focus: .7, brightness: .6, faceCount: 0 }] },
      sceneSegments: [{ id: 'scene', text: 'A person walks.', start: 0, end: 2 }],
      transcript: [{ id: 'word', text: 'Walk', start: .5, end: .7 }],
    });

    expect(Object.keys(result.overview.lanes).sort()).toEqual(['audio', 'cuts', 'focus', 'markers', 'motion', 'people', 'quality', 'scenes', 'speech', 'text']);
    expect(result.overview.lanes.motion).toHaveLength(1);
    expect(result.overview.lanes.focus).toHaveLength(1);
    expect(result.overview.lanes.quality).toHaveLength(1);
    expect(result.overview.lanes.audio).toEqual([]);
    expect(result.overview.lanes.markers).toEqual([]);
    expect(result.scenes[0].coverage.audio).toMatchObject({ state: 'unavailable' });
  });

  it('populates source-time audio and marker lanes with real coverage', () => {
    const result = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 10, outPoint: 20 },
      audio: {
        levels: [
          { start: 10, end: 11, loudnessDb: -60 },
          { start: 11, end: 12, loudnessDb: 0 },
        ],
        vadSegments: [{ start: 13, end: 15, probability: 0.8 }],
        markers: [{ id: 'breath-1', kind: 'breath', time: 14, confidence: 0.9 }],
      },
      channels: { audio: { status: 'ready' } },
    });

    expect(result.overview.lanes.audio).toMatchObject([
      { start: 10, end: 11, label: 'Loudness', score: 0 },
      { start: 11, end: 12, label: 'Loudness', score: 1 },
      { start: 13, end: 15, label: 'Speech activity', score: 0.8 },
    ]);
    expect(result.overview.lanes.markers).toEqual([
      { id: 'breath-1', start: 14, label: 'breath', score: 0.9 },
    ]);
    expect(result.scenes[0].coverage.audio).toMatchObject({ state: 'complete' });
  });

  it('distinguishes a completed no-cut scan from missing cut analysis', () => {
    const completed = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 2 },
      cuts: [],
    });
    const missing = buildAnalysisWorkspaceViewModel({
      range: { inPoint: 0, outPoint: 2 },
    });

    expect(completed.scenes[0].coverage.cuts).toMatchObject({ state: 'complete' });
    expect(missing.scenes[0].coverage.cuts).toMatchObject({ state: 'missing' });
  });
});

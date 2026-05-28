import { describe, expect, it } from 'vitest';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
  resolveTimelineAudioRegionSelection,
} from '../../src/components/timeline/utils/audioEditSelection';
import { createMockClip } from '../helpers/mockData';

describe('timeline audio edit selection', () => {
  it('creates a timeline and source region for an audio clip drag', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
      waveform: [0.4, 0.3, 0.2, 0.1, 0.2, 0.3],
    });

    const selection = resolveTimelineAudioRegionSelection({
      clip,
      anchorTimelineTime: 11,
      focusTimelineTime: 13,
      snapThresholdSeconds: 0,
    });

    expect(selection).toMatchObject({
      clipId: 'audio-clip',
      trackId: 'audio-1',
      startTime: 11,
      endTime: 13,
      sourceInPoint: 3,
      sourceOutPoint: 5,
    });
  });

  it('snaps selection edges to nearby waveform valleys', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      waveform: [0.8, 0.7, 0.02, 0.6, 0.5, 0.03, 0.7, 0.9],
    });

    const selection = resolveTimelineAudioRegionSelection({
      clip,
      anchorTimelineTime: 0.85,
      focusTimelineTime: 2.35,
      snapThresholdSeconds: 0.65,
    });

    expect(selection.snappedToZeroCrossing).toBe(true);
    expect(selection.startTime).toBeCloseTo(1.14, 1);
    expect(selection.endTime).toBeCloseTo(2.86, 1);
  });

  it('maps reversed clips back to ascending source ranges', () => {
    const clip = createMockClip({
      id: 'reversed-audio',
      trackId: 'audio-1',
      startTime: 5,
      duration: 2,
      inPoint: 10,
      outPoint: 14,
      reversed: true,
      waveform: [0.2, 0.3, 0.4, 0.5],
    });

    const selection = resolveTimelineAudioRegionSelection({
      clip,
      anchorTimelineTime: 5.25,
      focusTimelineTime: 6,
      snapThresholdSeconds: 0,
    });

    expect(selection.startTime).toBe(5.25);
    expect(selection.endTime).toBe(6);
    expect(selection.sourceInPoint).toBe(12);
    expect(selection.sourceOutPoint).toBe(13.5);
  });

  it('moves a selected region without changing its duration', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
    });

    const selection = resolveTimelineAudioRegionSelection({
      clip,
      anchorTimelineTime: 11,
      focusTimelineTime: 13,
      snapThresholdSeconds: 0,
    });
    const moved = moveTimelineAudioRegionSelection({
      clip,
      selection,
      deltaTimelineSeconds: 1.25,
    });

    expect(moved.startTime).toBe(12.25);
    expect(moved.endTime).toBe(14.25);
    expect(moved.sourceInPoint).toBe(4.25);
    expect(moved.sourceOutPoint).toBe(6.25);
  });

  it('clamps moved regions to the clip bounds', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
    });

    const selection = resolveTimelineAudioRegionSelection({
      clip,
      anchorTimelineTime: 12,
      focusTimelineTime: 14,
      snapThresholdSeconds: 0,
    });
    const moved = moveTimelineAudioRegionSelection({
      clip,
      selection,
      deltaTimelineSeconds: 100,
    });

    expect(moved.startTime).toBe(13);
    expect(moved.endTime).toBe(15);
    expect(moved.sourceInPoint).toBe(5);
    expect(moved.sourceOutPoint).toBe(7);
  });

  it('resizes a selected region from its left edge', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
    });

    const selection = resolveTimelineAudioRegionSelection({
      clip,
      anchorTimelineTime: 11,
      focusTimelineTime: 13,
      snapThresholdSeconds: 0,
    });
    const resized = resizeTimelineAudioRegionSelection({
      clip,
      selection,
      edge: 'left',
      focusTimelineTime: 10.5,
      snapThresholdSeconds: 0,
    });

    expect(resized.startTime).toBe(10.5);
    expect(resized.endTime).toBe(13);
    expect(resized.sourceInPoint).toBe(2.5);
    expect(resized.sourceOutPoint).toBe(5);
  });

  it('clamps resized regions to the clip bounds', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
    });

    const selection = resolveTimelineAudioRegionSelection({
      clip,
      anchorTimelineTime: 12,
      focusTimelineTime: 14,
      snapThresholdSeconds: 0,
    });
    const resized = resizeTimelineAudioRegionSelection({
      clip,
      selection,
      edge: 'right',
      focusTimelineTime: 100,
      snapThresholdSeconds: 0,
    });

    expect(resized.startTime).toBe(12);
    expect(resized.endTime).toBe(15);
    expect(resized.sourceInPoint).toBe(4);
    expect(resized.sourceOutPoint).toBe(7);
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { VolumeTab } from '../../src/components/panels/properties/VolumeTab';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

beforeEach(() => {
  useTimelineStore.setState({
    clips: [createMockClip({ id: 'range-clip', trackId: 'range-track', effects: [], source: { type: 'audio', naturalDuration: 5 } })],
    tracks: [createMockTrack({ id: 'range-track', type: 'audio' })],
    playheadPosition: 0,
    clipKeyframes: new Map(),
    keyframeRecordingEnabled: new Set(),
  });
});
afterEach(cleanup);

it('stores +64 dB, caps numeric entry, keeps the slider at +18 dB and resets to unity', () => {
  render(<VolumeTab clipId="range-clip" effects={[]} />);
  const gain = () => useTimelineStore.getState().clips[0].effects.find(effect => effect.type === 'audio-volume')?.params.volume;
  const enter = (value: string) => {
    fireEvent.doubleClick(screen.getByLabelText('Audio volume'));
    fireEvent.change(screen.getByTitle('Enter value'), { target: { value } });
    fireEvent.keyDown(screen.getByTitle('Enter value'), { key: 'Enter' });
  };
  enter('64');
  expect(gain()).toBeCloseTo(10 ** (64 / 20), 6);
  expect(screen.getByLabelText('Audio volume')).toHaveAttribute('aria-valuenow', '64');
  expect(screen.getByLabelText('Audio volume slider')).toHaveAttribute('aria-valuemax', '18');
  enter('80');
  expect(gain()).toBeCloseTo(10 ** (64 / 20), 6);
  fireEvent.keyDown(screen.getByLabelText('Audio volume slider'), { key: 'End' });
  expect(gain()).toBeCloseTo(10 ** (18 / 20), 6);
  fireEvent.click(screen.getByRole('button', { name: 'Reset Level' }));
  expect(gain()).toBe(1);
  enter('-60');
  expect(gain()).toBe(0);
});

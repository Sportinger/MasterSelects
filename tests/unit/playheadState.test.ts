import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearInternalPlaybackHold,
  getInternalPlaybackPosition,
  holdInternalPlaybackPosition,
  playheadState,
  setMasterAudioClock,
  startInternalPosition,
  stopInternalPosition,
} from '../../src/services/layerBuilder/PlayheadState';

describe('PlayheadState playback hold', () => {
  beforeEach(() => {
    playheadState.position = 0;
    playheadState.isUsingInternalPosition = false;
    playheadState.playbackJustStarted = false;
    playheadState.hasMasterAudio = false;
    playheadState.masterAudioElement = null;
    playheadState.masterAudioClock = null;
    playheadState.heldPlaybackPosition = null;
    playheadState.heldPlaybackClipId = null;
    playheadState.clockStartTimeMs = null;
    playheadState.clockStartPosition = 0;
    playheadState.clockPlaybackSpeed = 1;
  });

  it('keeps a held playback position pinned to its owning clip', () => {
    holdInternalPlaybackPosition(30, 'clip-a');

    clearInternalPlaybackHold('clip-b');

    expect(playheadState.heldPlaybackPosition).toBe(30);
    expect(playheadState.heldPlaybackClipId).toBe('clip-a');

    clearInternalPlaybackHold('clip-a');

    expect(playheadState.heldPlaybackPosition).toBeNull();
    expect(playheadState.heldPlaybackClipId).toBeNull();
  });

  it('clears any held playback position when internal playback starts or stops', () => {
    holdInternalPlaybackPosition(18, 'clip-a');

    startInternalPosition(12);

    expect(playheadState.position).toBe(12);
    expect(playheadState.heldPlaybackPosition).toBeNull();
    expect(playheadState.heldPlaybackClipId).toBeNull();

    holdInternalPlaybackPosition(24, 'clip-b');
    stopInternalPosition();

    expect(playheadState.heldPlaybackPosition).toBeNull();
    expect(playheadState.heldPlaybackClipId).toBeNull();
  });

  it('does not let a forward audio clock move the internal playhead backward', () => {
    startInternalPosition(10, 1);
    playheadState.position = 12;
    setMasterAudioClock(() => 11.5, 0, 0, 1);

    expect(getInternalPlaybackPosition(playheadState.position)).toBe(12);

    setMasterAudioClock(() => 12.75, 0, 0, 1);

    expect(getInternalPlaybackPosition(playheadState.position)).toBe(12.75);
  });
});

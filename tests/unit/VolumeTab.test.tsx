import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VolumeTab } from '../../src/components/panels/properties/VolumeTab';
import { useTimelineStore } from '../../src/stores/timeline';
import { runtimeAudioMeterBus } from '../../src/services/audio/runtimeAudioMeterBus';
import { normalizeAudioEqParams } from '../../src/engine/audio/eq/AudioEqLegacy';
import type { AudioEffectInstance } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function createStackEqEffect(id = 'eq-1'): AudioEffectInstance {
  return {
    id,
    descriptorId: 'audio-eq',
    enabled: true,
    params: {},
    automationMode: 'clip',
  };
}

function addStackEqFromSelect(container: HTMLElement): AudioEffectInstance {
  const addSelect = container.querySelector('.audio-effect-add-select');
  expect(addSelect).not.toBeNull();

  fireEvent.change(addSelect!, { target: { value: 'audio-eq' } });

  const effect = useTimelineStore.getState().clips[0].audioState?.effectStack?.find(item => item.descriptorId === 'audio-eq');
  expect(effect).toBeDefined();
  if (!effect) throw new Error('Expected stack EQ effect to be created');
  return effect;
}

function getSelectedBandNumbers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.flex-eq-module-knobs .draggable-number'));
}

function getSelectedBandKeyframeToggles(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.flex-eq-module-knobs .keyframe-toggle'));
}

function getSelectedBandAllKeyframeToggle(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.flex-eq-module-keyframes .keyframe-toggle');
}

describe('VolumeTab', () => {
  beforeEach(() => {
    runtimeAudioMeterBus.resetForTest();
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'audio-1',
          effects: [],
          source: { type: 'audio', naturalDuration: 5 },
        }),
      ],
      tracks: [createMockTrack({ id: 'audio-1', type: 'audio' })],
      playheadPosition: 0,
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
      runtimeAudioMeters: { trackMeters: {} },
    });
  });

  afterEach(() => {
    cleanup();
    useTimelineStore.setState({
      clips: [],
      tracks: [],
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
      runtimeAudioMeters: { trackMeters: {} },
    });
  });

  it('does not create legacy volume or EQ effects just by rendering', () => {
    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);

    expect(useTimelineStore.getState().clips[0].effects).toEqual([]);
    expect(useTimelineStore.getState().clips[0].audioState?.effectStack ?? []).toEqual([]);
    expect(screen.queryByText('Legacy Equalizer')).toBeNull();
    expect(container.querySelector('.flex-eq')).toBeNull();
  });

  it('creates the legacy volume effect only when the user edits volume', () => {
    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const volumeControl = container.querySelector('.control-row .draggable-number');
    expect(volumeControl).not.toBeNull();

    fireEvent.doubleClick(volumeControl!);
    fireEvent.change(screen.getByTitle('Enter value'), { target: { value: '-6' } });
    fireEvent.keyDown(screen.getByTitle('Enter value'), { key: 'Enter' });

    const effects = useTimelineStore.getState().clips[0].effects;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'audio-volume',
      params: { volume: expect.closeTo(0.501, 3) },
    });
  });

  it('adds EQ through the audio FX stack and updates the selected graph band when edited', () => {
    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const eqEffect = addStackEqFromSelect(container);
    const selectedBandNumbers = getSelectedBandNumbers(container);
    expect(selectedBandNumbers.length).toBeGreaterThanOrEqual(3);

    fireEvent.doubleClick(selectedBandNumbers[1]);
    fireEvent.change(screen.getByTitle('Enter value'), { target: { value: '4.5' } });
    fireEvent.keyDown(screen.getByTitle('Enter value'), { key: 'Enter' });

    const clip = useTimelineStore.getState().clips[0];
    const updatedEqEffect = clip.audioState?.effectStack?.find(effect => effect.id === eqEffect.id);
    expect(updatedEqEffect).toBeDefined();
    if (!updatedEqEffect) throw new Error('Expected EQ effect to be updated');

    const eq = normalizeAudioEqParams(updatedEqEffect.params);
    expect(eq.audible.bands.find(band => band.id === 'band31')?.gainDb).toBe(4.5);
    expect(clip.effects.find(effect => effect.type === 'audio-eq')).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(updatedEqEffect.params, 'eq.audible.bands.band31.gainDb')).toBe(false);
  });

  it('lets the user switch the EQ spectrum between source and adjusted views', async () => {
    // The live analyzer spectrum now streams through the runtime audio meter bus.
    runtimeAudioMeterBus.publishTrack('audio-1', {
      peakLinear: 0.2,
      rmsLinear: 0.1,
      peakDb: -14,
      rmsDb: -20,
      clipping: false,
      spectrumDb: new Float32Array(128).fill(-60),
      updatedAt: 1,
    });

    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const eqEffect = addStackEqFromSelect(container);
    const spectrumView = within(screen.getByRole('group', { name: 'Spectrum view' }));

    await waitFor(() => expect(spectrumView.getByRole('button', { name: 'Source' })).not.toBeDisabled());
    fireEvent.click(spectrumView.getByRole('button', { name: 'Source' }));

    await waitFor(() => {
      const updatedEqEffect = useTimelineStore.getState().clips[0].audioState?.effectStack?.find(effect => effect.id === eqEffect.id);
      expect(updatedEqEffect).toBeDefined();
      if (!updatedEqEffect) throw new Error('Expected EQ effect to be updated');
      expect(normalizeAudioEqParams(updatedEqEffect.params).display.analyzerMode).toBe('pre');
    });
  });

  it('sets keyframes for every numeric parameter on the selected flexible EQ band', () => {
    const eqEffect = createStackEqEffect();
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'audio-1',
          effects: [],
          audioState: { effectStack: [eqEffect] },
          source: { type: 'audio', naturalDuration: 5 },
        }),
      ],
    });

    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const keyframeToggle = getSelectedBandAllKeyframeToggle(container);
    expect(keyframeToggle).not.toBeNull();

    fireEvent.click(keyframeToggle!);

    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [];
    expect(keyframes).toHaveLength(13);
    expect(keyframes.map(keyframe => keyframe.property)).toEqual(expect.arrayContaining([
      'effect.eq-1.eq.audible.bands.band31.frequencyHz',
      'effect.eq-1.eq.audible.bands.band31.gainDb',
      'effect.eq-1.eq.audible.bands.band31.q',
      'effect.eq-1.eq.audible.bands.band31.dynamic.thresholdDb',
      'effect.eq-1.eq.audible.bands.band31.spectralDynamics.thresholdDb',
    ]));
    expect(useTimelineStore.getState().isRecording(
      'clip-1',
      'effect.eq-1.eq.audible.bands.band31.gainDb',
    )).toBe(true);
  });

  it('keeps EQ keyframing connected after the EQ effect is added from the stack', () => {
    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const eqEffect = addStackEqFromSelect(container);
    const selectedBandNumbers = getSelectedBandNumbers(container);

    fireEvent.doubleClick(selectedBandNumbers[1]);
    fireEvent.change(screen.getByTitle('Enter value'), { target: { value: '3.5' } });
    fireEvent.keyDown(screen.getByTitle('Enter value'), { key: 'Enter' });

    const keyframeToggle = getSelectedBandKeyframeToggles(container)[1];
    expect(keyframeToggle).not.toBeNull();

    const selectedBandToggles = getSelectedBandKeyframeToggles(container);
    fireEvent.click(selectedBandToggles[1]);

    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [];
    expect(keyframes).toHaveLength(1);
    expect(keyframes[0]).toMatchObject({
      property: `effect.${eqEffect.id}.eq.audible.bands.band31.gainDb`,
      value: 3.5,
    });
  });

  it('records another EQ band keyframe when gain changes while recording', () => {
    const eqEffect = createStackEqEffect();
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'audio-1',
          effects: [],
          audioState: { effectStack: [eqEffect] },
          source: { type: 'audio', naturalDuration: 5 },
        }),
      ],
    });

    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    fireEvent.click(getSelectedBandKeyframeToggles(container)[1]);

    act(() => {
      useTimelineStore.setState({ playheadPosition: 1 });
    });

    const selectedBandNumbers = getSelectedBandNumbers(container);
    fireEvent.doubleClick(selectedBandNumbers[1]);
    fireEvent.change(screen.getByTitle('Enter value'), { target: { value: '5' } });
    fireEvent.keyDown(screen.getByTitle('Enter value'), { key: 'Enter' });

    const keyframes = (useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [])
      .filter(keyframe => keyframe.property === 'effect.eq-1.eq.audible.bands.band31.gainDb');

    expect(keyframes).toHaveLength(2);
    expect(keyframes.map(keyframe => ({ time: keyframe.time, value: keyframe.value }))).toEqual([
      { time: 0, value: 0 },
      { time: 1, value: 5 },
    ]);
  });

  it('records frequency keyframes when frequency changes while recording', () => {
    const eqEffect = createStackEqEffect();
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'audio-1',
          effects: [],
          audioState: { effectStack: [eqEffect] },
          source: { type: 'audio', naturalDuration: 5 },
        }),
      ],
    });

    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const selectedBandToggles = getSelectedBandKeyframeToggles(container);
    fireEvent.click(selectedBandToggles[0]);

    act(() => {
      useTimelineStore.setState({ playheadPosition: 1 });
    });

    const selectedBandNumbers = getSelectedBandNumbers(container);
    fireEvent.doubleClick(selectedBandNumbers[0]);
    fireEvent.change(screen.getByTitle('Enter value'), { target: { value: '120' } });
    fireEvent.keyDown(screen.getByTitle('Enter value'), { key: 'Enter' });

    const keyframes = (useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [])
      .filter(keyframe => keyframe.property === 'effect.eq-1.eq.audible.bands.band31.frequencyHz');

    expect(keyframes).toHaveLength(2);
    expect(keyframes.map(keyframe => ({ time: keyframe.time, value: keyframe.value }))).toEqual([
      { time: 0, value: 31 },
      { time: 1, value: 120 },
    ]);
  });

  it('shows interpolated EQ band values between two keyframes', () => {
    const eqEffect = createStackEqEffect();
    useTimelineStore.setState({
      playheadPosition: 0.5,
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'audio-1',
          effects: [],
          audioState: { effectStack: [eqEffect] },
          source: { type: 'audio', naturalDuration: 5 },
        }),
      ],
      clipKeyframes: new Map([
        ['clip-1', [
          {
            id: 'kf-a',
            clipId: 'clip-1',
            property: 'effect.eq-1.eq.audible.bands.band31.gainDb',
            time: 0,
            value: 0,
            easing: 'linear',
          },
          {
            id: 'kf-b',
            clipId: 'clip-1',
            property: 'effect.eq-1.eq.audible.bands.band31.gainDb',
            time: 1,
            value: 5,
            easing: 'linear',
          },
        ]],
      ]),
    });

    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const selectedBandNumbers = getSelectedBandNumbers(container);

    expect(selectedBandNumbers[1]).toHaveTextContent('2.5');
  });

  it('uses nested EQ numeric paths for the stack-wide EQ keyframe all toggle', () => {
    const eqEffect = createStackEqEffect();
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'audio-1',
          effects: [],
          audioState: { effectStack: [eqEffect] },
          source: { type: 'audio', naturalDuration: 5 },
        }),
      ],
    });

    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const sectionToggle = container.querySelector('.audio-effect-stack-item-header .keyframe-toggle');
    expect(sectionToggle).not.toBeNull();

    fireEvent.click(sectionToggle!);

    const properties = (useTimelineStore.getState().clipKeyframes.get('clip-1') ?? [])
      .map(keyframe => keyframe.property);
    expect(properties).toContain('effect.eq-1.eq.audible.bands.band31.frequencyHz');
    expect(properties).toContain('effect.eq-1.eq.audible.bands.band31.gainDb');
    expect(properties).toContain('effect.eq-1.eq.audible.bands.band31.q');
    expect(properties).toContain('effect.eq-1.eq.audible.bands.band31.dynamic.thresholdDb');
    expect(properties).toContain('effect.eq-1.eq.audible.bands.band31.spectralDynamics.thresholdDb');
    expect(properties).toContain('effect.eq-1.eq.audible.bands.band16k.gainDb');
    expect(properties).not.toContain('effect.eq-1.band31');
  });
});

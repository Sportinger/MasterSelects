import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EffectSectionBypass } from '../../src/components/panels/properties/resolveInspector/EffectSectionBypass';
import { SlitScanTimeFieldControls } from '../../src/components/panels/properties/SlitScanTimeFieldControls';
import { useTimelineStore } from '../../src/stores/timeline';
import { getDefaultParams } from '../../src/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';

afterEach(() => { cleanup(); useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }); });
it('uses the effect-panel switches to persist independent bypasses while keeping parameter values', () => {
  const params = { ...getDefaultParams('slit-scan'), mapSource: 'motion', mapGamma: 2 };
  const effect = { id: 'scan', type: 'slit-scan', name: 'Slit Scan', enabled: true, params };
  const clip = createMockClip({ id: 'clip', effects: [effect] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  const view = render(<EffectSectionBypass clipId="clip" effectId="scan"><SlitScanTimeFieldControls
    clipId="clip" effectInstanceId="scan" params={params} onChange={next => useTimelineStore.getState().updateClipEffect('clip', 'scan', next)} />
  </EffectSectionBypass>);
  for (const [title, id] of [['RGB time', 'rgb-time'], ['Field shaping', 'field-shaping'], ['Field combination', 'field-combination'],
    ['Field noise', 'field-noise'], ['Motion field', 'field-motion']]) {
    const button = view.getByRole('switch', { name: `Disable ${title}` });
    button.focus(); fireEvent.pointerUp(button); fireEvent.click(button, { detail: 1 });
    expect(button).not.toHaveFocus();
    expect(view.getByRole('switch', { name: `Enable ${title}` })).toHaveAttribute('aria-checked', 'false');
    const saved = useTimelineStore.getState().clips[0].effects[0];
    expect(effectOperatorGraph(saved).groups?.find(group => group.id === id)?.bypassed).toBe(true);
    expect(saved.params.mapGamma).toBe(2);
    button.focus(); fireEvent.click(button, { detail: 0 });
    expect(button).toHaveFocus();
    expect(view.getByRole('switch', { name: `Disable ${title}` })).toHaveAttribute('aria-checked', 'true');
  }
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EffectSectionBypass } from '../../src/components/panels/properties/resolveInspector/EffectSectionBypass';
import { ResolveInspectorSection } from '../../src/components/panels/properties/resolveInspector/ResolveInspectorPrimitives';
import { setEffectGroupEnabled } from '../../src/services/operators/effectGroupBypassEditing';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { getDefaultParams } from '../../src/effects';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import type { Effect } from '../../src/types/effects';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

it('synchronizes section clicks, group projection and node-group actions without changing parameters', () => {
  const effect: Effect = { id: 'slit', type: 'slit-scan', name: 'Slit Scan', enabled: true, params: getDefaultParams('slit-scan') };
  const clip = createMockClip({ id: 'section-clip', trackId: 'section-track', effects: [effect] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'section-track', locked: false })] });
  render(<EffectSectionBypass clipId={clip.id} effectId={effect.id}>
    <ResolveInspectorSection title="Protection mask" bypassGroupId="subject-protection">Mask settings</ResolveInspectorSection>
    <ResolveInspectorSection title="Subject protection" bypassGroupId="subject-protection">Strength settings</ResolveInspectorSection>
  </EffectSectionBypass>);
  fireEvent.click(screen.getByRole('switch', { name: 'Disable Protection mask' }));
  expect(screen.getByRole('switch', { name: 'Enable Subject protection' }).getAttribute('aria-checked')).toBe('false');
  const savedClip = useTimelineStore.getState().clips.find(item => item.id === clip.id)!;
  const savedEffect = savedClip.effects[0];
  expect(savedEffect.params).toEqual(effect.params);
  expect(effectOperatorGraph(savedEffect).groups!.find(group => group.id === 'subject-protection')?.bypassed).toBe(true);
  expect(buildEffectOperatorGraph(savedClip, savedEffect).groups!.find(group => group.id === 'subject-protection')?.bypassed).toBe(true);
  act(() => setEffectGroupEnabled(clip.id, effect.id, 'subject-protection', true));
  expect(screen.getByRole('switch', { name: 'Disable Protection mask' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('switch', { name: 'Disable Subject protection' }).getAttribute('aria-checked')).toBe('true');
});

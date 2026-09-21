import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EffectPresetLibrary } from '../../src/components/panels/nodes/workspace/EffectPresetLibrary';
import { EFFECT_PRESET_STORAGE_KEY } from '../../src/services/nodeGraph/effectPresetLibrary';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

afterEach(() => { cleanup(); localStorage.removeItem(EFFECT_PRESET_STORAGE_KEY); useTimelineStore.setState({ clips: [], tracks: [] }); });

it('saves with the keyboard, restores the library after remount, and inserts with pointer focus cleared', async () => {
  const user = userEvent.setup();
  const clip = createMockClip({ effects: [{ id: 'e', name: 'Invert', type: 'invert', enabled: true, params: {} }] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  const props = { clipId: clip.id, effect: clip.effects[0], width: 280, locked: false, onSelectNode: () => {} };
  const view = render(<EffectPresetLibrary {...props} />);
  await user.click(screen.getByRole('textbox', { name: 'Effect preset name' }));
  await user.type(screen.getByRole('textbox'), 'Keyboard preset');
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save effect copy' }));
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save effect copy' }));
  expect(screen.getByRole('status').textContent).toBe('Effect preset saved.');
  view.unmount();
  render(<EffectPresetLibrary {...props} />);
  const add = screen.getByRole('button', { name: 'Add Keyboard preset' });
  await user.click(add);
  expect(document.activeElement).not.toBe(add);
  expect(useTimelineStore.getState().clips[0].effects).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Delete preset Keyboard preset' }));
  expect(screen.queryByRole('button', { name: 'Add Keyboard preset' })).toBeNull();
  expect(useTimelineStore.getState().clips[0].effects).toHaveLength(2);
});

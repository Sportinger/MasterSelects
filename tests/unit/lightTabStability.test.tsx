import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import { LightTab } from '../../src/components/panels/properties/LightTab';

vi.mock('../../src/stores/mediaStore', async () => {
  const { create } = await import('zustand');
  return { useMediaStore: create(() => ({ files: [] })) };
});
vi.mock('../../src/stores/timeline', async () => {
  const { create } = await import('zustand');
  const { DEFAULT_LIGHT_CLIP_SETTINGS } = await import('../../src/types/light');
  const clip = { id: 'light', name: 'Scene light', startTime: 0,
    source: { type: 'light', lightSettings: DEFAULT_LIGHT_CLIP_SETTINGS } };
  const useTimelineStore = create<any>((set, get) => ({
    clips: [clip], playheadPosition: 0, clipKeyframes: new Map(),
    getInterpolatedLightSettings: () => get().clips[0].source.lightSettings,
    setPropertyValue: vi.fn(),
    updateClip: (_id: string, patch: object) => set({ clips: [{ ...get().clips[0], ...patch }] }),
  }));
  return { useTimelineStore };
});
vi.mock('../../src/components/panels/properties/shared', () => ({
  DraggableNumber: () => null, KeyframeToggle: () => null, MultiKeyframeToggle: () => null,
}));
afterEach(cleanup);
it('keeps the light inspector mounted across media updates and shadow edits', () => {
  render(<LightTab clipId="light" />);
  expect(screen.getByText('Scene Light')).toBeInTheDocument();
  act(() => useMediaStore.setState({ files: [] }));
  const shadows = screen.getByRole('checkbox', { name: 'Cast shadows' });
  fireEvent.click(shadows);
  expect(shadows).toBeChecked();
  expect(screen.getByText('Scene Light')).toBeInTheDocument();
});

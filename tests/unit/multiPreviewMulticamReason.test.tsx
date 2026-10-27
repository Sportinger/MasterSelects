// The multi-preview multicam toggle names the real reason when it cannot act: the export edit lock
// while an export runs, the missing camera tracks only when turning multicam on failed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../src/components/preview/MultiPreviewSlot', () => ({ MultiPreviewSlot: () => null }));
vi.mock('../../src/components/preview/StatsOverlay', () => ({ StatsOverlay: () => null }));

const media = vi.hoisted(() => ({ state: { compositions: [] as unknown[], activeCompositionId: null as string | null } }));
vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(
    (selector: (state: typeof media.state) => unknown) => selector(media.state),
    { getState: () => media.state, setState: () => {}, subscribe: () => () => {} },
  ),
}));

const { useTimelineStore } = await import('../../src/stores/timeline');
const { MultiPreviewPanel } = await import('../../src/components/preview/MultiPreviewPanel');
import type { MultiPreviewPanelData } from '../../src/types/dock';

const DATA = {
  sourceCompositionId: null,
  slots: [{ compositionId: null }, { compositionId: null }, { compositionId: null }, { compositionId: null }],
  showTransparencyGrid: false,
} as unknown as MultiPreviewPanelData;

function setup(multicamActive: boolean, exporting: boolean) {
  const composition = {
    id: 'comp-1', name: 'Comp 1',
    multicam: multicamActive ? { active: true, angles: [] } : undefined,
  };
  media.state = { compositions: [composition], activeCompositionId: 'comp-1' };
  const setMulticamActive = vi.fn(() => false);
  useTimelineStore.setState({ isExporting: exporting, setMulticamActive } as never);
  render(<MultiPreviewPanel panelId="multi" data={DATA} />);
  fireEvent.click(screen.getByRole('button', { name: 'Multicam' }));
  return { setMulticamActive, status: screen.getByTestId('multi-preview-status').textContent ?? '' };
}

describe('multi-preview multicam toggle reasons', () => {
  let realSetMulticamActive: unknown;
  beforeEach(() => { realSetMulticamActive = useTimelineStore.getState().setMulticamActive; });
  afterEach(() => {
    cleanup();
    useTimelineStore.setState({ isExporting: false, setMulticamActive: realSetMulticamActive } as never);
  });

  it('says editing is locked while exporting, for turning multicam on', () => {
    const { setMulticamActive, status } = setup(false, true);
    expect(status).toMatch(/export/i);
    expect(status).not.toMatch(/two video tracks/);
    expect(setMulticamActive).not.toHaveBeenCalled();
  });

  it('says editing is locked while exporting, for turning multicam off', () => {
    const { status } = setup(true, true);
    expect(status).toMatch(/export/i);
    expect(status).not.toMatch(/two video tracks/);
  });

  it('names the missing camera tracks only when turning multicam on failed', () => {
    const { setMulticamActive, status } = setup(false, false);
    expect(setMulticamActive).toHaveBeenCalledWith(true);
    expect(status).toMatch(/two video tracks/);
  });

  it('a failed turn-off does not claim missing camera tracks', () => {
    const { setMulticamActive, status } = setup(true, false);
    expect(setMulticamActive).toHaveBeenCalledWith(false);
    expect(status).not.toMatch(/two video tracks/);
  });
});

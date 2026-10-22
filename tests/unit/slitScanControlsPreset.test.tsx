import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SlitScanControls } from '../../src/components/panels/properties/SlitScanControls';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { getDefaultParams } from '../../src/effects';
import { applySlitScanLook } from '../../src/effects/time/slit-scan/looks';
import { createMockClip, createMockTrack } from '../helpers/mockData';

afterEach(() => { cleanup(); useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }); });

const ANGLE_NOTE = 'Radial scan and Time rings spread from the centre: Angle does nothing there.';

function renderCard(params: Record<string, number | boolean | string>) {
  const effect = { id: 'scan', type: 'slit-scan', name: 'Slit Scan', enabled: true, params };
  const clip = createMockClip({ id: 'clip', effects: [effect] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  // tests/setup.ts mocks the media store; the card reads its file list through a selector.
  vi.mocked(useMediaStore).mockImplementation(((selector: (state: { files: unknown[] }) => unknown) => selector({ files: [] })) as never);
  return render(<SlitScanControls effectId="slit-scan" effectInstanceId="scan" clipId="clip" params={params} onChange={() => {}} />);
}

it('shows its own Preset row above the Time section and names the applied preset', () => {
  const view = renderCard(applySlitScanLook({ ...getDefaultParams('slit-scan'), temporalStorage: 'hybrid' }, 'rings'));
  const preset = view.getByLabelText('Slit Scan preset');
  expect(preset.textContent).toContain('Time Rings');
  const time = view.getByText('Time', { selector: '*' });
  // The Preset row comes before the Time section in the card.
  expect(preset.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(view.queryByText('Look')).toBeNull();
});

it('reads Apply preset… on the defaults, which match no preset', () => {
  const view = renderCard(getDefaultParams('slit-scan'));
  expect(view.getByLabelText('Slit Scan preset').textContent).toContain('Apply preset…');
});

it('dims Angle with its reason in the radial profiles only', () => {
  const radial = renderCard({ ...getDefaultParams('slit-scan'), profile: 'radial' });
  expect(radial.getByText(ANGLE_NOTE)).toBeTruthy();
  cleanup();
  const linear = renderCard({ ...getDefaultParams('slit-scan'), profile: 'linear' });
  expect(linear.queryByText(ANGLE_NOTE)).toBeNull();
});

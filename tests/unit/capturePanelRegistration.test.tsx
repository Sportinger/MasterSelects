import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/panels/capture/CapturePanel', () => ({
  CapturePanel: () => <div>Capture panel loaded</div>,
}));

import { DockPanelContent } from '../../src/components/dock/DockPanelContent';
import { VIEW_CORE_PANEL_TYPES, VIEW_WIP_ONLY_PANEL_TYPES } from '../../src/components/common/toolbar/viewPanelConfig';
import { BUILT_IN_PANEL_TYPES, VALID_PANEL_TYPES } from '../../src/stores/dockStore/panelRegistry';
import { PANEL_CONFIGS, WIP_PANEL_TYPES } from '../../src/types/dock';

describe('capture panel registration', () => {
  it('is available as a finished core panel', () => {
    expect(PANEL_CONFIGS.capture).toMatchObject({ type: 'capture', title: 'Capture' });
    expect(Object.keys(PANEL_CONFIGS)).toContain('capture');
    expect(BUILT_IN_PANEL_TYPES).toContain('capture');
    expect(VALID_PANEL_TYPES.has('capture')).toBe(true);
    expect(WIP_PANEL_TYPES).not.toContain('capture');
    expect(VIEW_WIP_ONLY_PANEL_TYPES).not.toContain('capture');
    expect(VIEW_CORE_PANEL_TYPES).toContain('capture');
  });

  it('renders the lazy Capture panel content', async () => {
    render(<DockPanelContent panel={{ id: 'capture-1', type: 'capture', title: 'Capture' }} />);
    expect(await screen.findByText('Capture panel loaded', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

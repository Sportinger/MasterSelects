import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/settingsStore');

import { GeneralSettings } from '../../src/components/common/settings/GeneralSettings';
import { setLegacyMobileDockLayoutEnabledForTests } from '../../src/stores/dockStore/legacyMobileLayout';

const AUTOMATIC_MOBILE_LABEL = 'Automatically use Mobile layout when space is limited';

afterEach(() => {
  setLegacyMobileDockLayoutEnabledForTests(null);
});

describe('General settings and the legacy Mobile dock layout', () => {
  it('hides the automatic Mobile layout toggle while the legacy layout is off', () => {
    render(<GeneralSettings />);

    expect(screen.queryByText(AUTOMATIC_MOBILE_LABEL)).not.toBeInTheDocument();
  });

  it('shows the toggle again when the legacy layout is switched on', () => {
    setLegacyMobileDockLayoutEnabledForTests(true);
    render(<GeneralSettings />);

    expect(screen.getByText(AUTOMATIC_MOBILE_LABEL)).toBeInTheDocument();
  });
});

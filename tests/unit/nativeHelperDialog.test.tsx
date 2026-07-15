import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeHelperStatus } from '../../src/components/common/NativeHelperStatus';
import { openNativeHelperDialog } from '../../src/components/common/nativeHelperDialog';

const settingsState = vi.hoisted(() => ({
  turboModeEnabled: false,
  nativeHelperPort: 9876,
  nativeDecodeEnabled: false,
  setNativeDecodeEnabled: vi.fn(),
  setNativeHelperConnected: vi.fn(),
  setTurboModeEnabled: vi.fn(),
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => settingsState),
}));

vi.mock('../../src/services/nativeHelper', () => ({
  NativeHelperClient: {
    configure: vi.fn(),
    getInfo: vi.fn(async () => null),
    onStatusChange: vi.fn(() => () => undefined),
  },
  isNativeHelperAvailable: vi.fn(async () => false),
}));

vi.mock('../../src/services/nativeHelper/releases', () => ({
  compareNativeHelperVersions: vi.fn(() => 0),
  fetchLatestPublishedNativeHelperRelease: vi.fn(async () => null),
  NATIVE_HELPER_RELEASES_URL: 'https://example.com/releases',
  NATIVE_HELPER_TARGET_VERSION: '0.0.0',
}));

afterEach(cleanup);

describe('Native Helper dialog', () => {
  it('opens one toolbar-owned dialog for a global request', async () => {
    render(
      <>
        <NativeHelperStatus />
        <NativeHelperStatus variant="info" />
      </>,
    );

    await act(async () => {
      openNativeHelperDialog();
      await Promise.resolve();
    });

    expect(screen.getAllByRole('dialog', { name: 'Native Helper' })).toHaveLength(1);
  });
});

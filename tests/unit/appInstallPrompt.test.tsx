import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallAppHint } from '../../src/components/common/InstallAppHint';
import {
  getAppInstallState,
  installAppInstallPromptCapture,
  isRunningAsInstalledApp,
  promptAppInstall,
  resetAppInstallPromptForTests,
} from '../../src/services/pwa/appInstallPrompt';

type Outcome = 'accepted' | 'dismissed';

function offerInstall(outcome: Outcome = 'accepted', prompt = vi.fn(async () => {})) {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: typeof prompt;
    userChoice: Promise<{ outcome: Outcome }>;
  };
  event.prompt = prompt;
  event.userChoice = Promise.resolve({ outcome });
  act(() => { window.dispatchEvent(event); });
  return { event, prompt };
}

function setDisplayMode(mode: string | null) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: mode !== null && query === `(display-mode: ${mode})`,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  setDisplayMode(null);
  resetAppInstallPromptForTests();
  installAppInstallPromptCapture();
});

afterEach(() => {
  cleanup();
  resetAppInstallPromptForTests();
});

describe('app install prompt capture', () => {
  it('keeps the browser install offer and suppresses the default mini-infobar', () => {
    expect(getAppInstallState().canInstall).toBe(false);
    const { event } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    expect(getAppInstallState()).toMatchObject({ canInstall: true, installed: false, dismissed: false });
  });

  it('reports the outcome and uses an offer only once', async () => {
    const { prompt } = offerInstall('accepted');
    await expect(promptAppInstall()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getAppInstallState()).toMatchObject({ canInstall: false, installed: true });
    await expect(promptAppInstall()).resolves.toBe('unavailable');
  });

  it('returns failed instead of throwing when the browser refuses the prompt', async () => {
    offerInstall('accepted', vi.fn(async () => { throw new DOMException('no activation', 'NotAllowedError'); }));
    await expect(promptAppInstall()).resolves.toBe('failed');
  });

  it('treats installed app windows as installed and never offers installing again', () => {
    setDisplayMode('standalone');
    expect(isRunningAsInstalledApp()).toBe(true);
    offerInstall();
    expect(getAppInstallState()).toMatchObject({ canInstall: false, installed: true });
  });

  it('marks the app installed when the browser reports appinstalled', () => {
    offerInstall();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(getAppInstallState()).toMatchObject({ canInstall: false, installed: true });
  });
});

describe('InstallAppHint', () => {
  it('stays hidden until the browser offers installation', () => {
    render(<InstallAppHint />);
    expect(screen.queryByText('Install MasterSelects to keep folder access')).toBeNull();
    offerInstall();
    expect(screen.getByText('Install MasterSelects to keep folder access')).toBeTruthy();
  });

  it('opens the browser install dialog from the click and confirms the installation', async () => {
    const { prompt } = offerInstall('accepted');
    render(<InstallAppHint />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install' })); });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Installed. Open MasterSelects from its app window');
  });

  it('says so when the install dialog cannot open', async () => {
    offerInstall('accepted', vi.fn(async () => { throw new Error('blocked'); }));
    render(<InstallAppHint />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install' })); });
    expect(screen.getByRole('alert').textContent).toContain('install icon in the address bar');
  });

  it('stays dismissed on this device', () => {
    offerInstall();
    const { unmount } = render(<InstallAppHint />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide install hint' }));
    expect(screen.queryByText('Install MasterSelects to keep folder access')).toBeNull();
    unmount();
    resetAppInstallPromptForTests();
    installAppInstallPromptCapture();
    offerInstall();
    render(<InstallAppHint />);
    expect(screen.queryByText('Install MasterSelects to keep folder access')).toBeNull();
  });

  it('releases pointer focus after a click', () => {
    offerInstall('dismissed');
    render(<InstallAppHint />);
    const dismiss = screen.getByRole('button', { name: 'Hide install hint' });
    dismiss.focus();
    fireEvent.pointerUp(dismiss);
    expect(document.activeElement).not.toBe(dismiss);
  });
});

describe('web app manifest', () => {
  const root = process.cwd();
  const manifest = JSON.parse(readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8')) as {
    start_url: string; scope: string; display: string; icons: Array<{ src: string; sizes: string; purpose: string }>;
  };

  it('is installable as a standalone editor app', () => {
    expect(manifest).toMatchObject({ start_url: '/editor', scope: '/editor', display: 'standalone' });
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        expect(manifest.icons.some(icon => icon.purpose === purpose && icon.sizes === size)).toBe(true);
      }
    }
  });

  it('points only at icons that exist with the declared size', () => {
    for (const icon of manifest.icons) {
      const png = readFileSync(path.join(root, 'public', icon.src));
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });

  it('is linked from the editor page', () => {
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });
});

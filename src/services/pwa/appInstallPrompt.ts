import { Logger } from '../logger';

/**
 * Captures Chromium's `beforeinstallprompt` so the editor can offer installing
 * MasterSelects as an app where folder access is re-allowed. An installed web
 * app keeps File System Access grants across browser restarts; a browser tab
 * loses them once the session ends and the user has to allow folders again.
 *
 * The deferred event is a runtime handle and stays in this module, not in a store.
 */

const log = Logger.create('AppInstall');

const DISMISS_STORAGE_KEY = 'ms.installAppHint.dismissed';
const INSTALLED_DISPLAY_MODES = ['standalone', 'window-controls-overlay', 'minimal-ui'] as const;

export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export type AppInstallOutcome = 'accepted' | 'dismissed' | 'unavailable' | 'failed';

export interface AppInstallState {
  /** The browser offered installation and the app is not running installed. */
  readonly canInstall: boolean;
  /** Running as an installed app window, or installed during this visit. */
  readonly installed: boolean;
  /** The user hid the hint on this device. */
  readonly dismissed: boolean;
}

interface InstallWindowLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
}

let deferredPrompt: BeforeInstallPromptEventLike | null = null;
let installedThisVisit = false;
let dismissed = readDismissed();
let snapshot: AppInstallState = computeState();
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

function targetWindow(): InstallWindowLike | null {
  return typeof window === 'undefined' ? null : window as unknown as InstallWindowLike;
}

function readDismissed(): boolean {
  try {
    return targetWindow()?.localStorage?.getItem(DISMISS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** True in an installed app window (Chrome/Edge PWA, or an iOS home screen app). */
export function isRunningAsInstalledApp(win: InstallWindowLike | null = targetWindow()): boolean {
  if (!win) return false;
  if (win.navigator?.standalone === true) return true;
  try {
    return INSTALLED_DISPLAY_MODES.some(mode => win.matchMedia?.(`(display-mode: ${mode})`).matches === true);
  } catch {
    return false;
  }
}

function computeState(): AppInstallState {
  const installed = installedThisVisit || isRunningAsInstalledApp();
  return { canInstall: !installed && deferredPrompt !== null, installed, dismissed };
}

function publish(): void {
  const next = computeState();
  if (next.canInstall === snapshot.canInstall && next.installed === snapshot.installed && next.dismissed === snapshot.dismissed) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function isInstallPromptEvent(event: Event): event is BeforeInstallPromptEventLike {
  return typeof (event as Partial<BeforeInstallPromptEventLike>).prompt === 'function';
}

/** Starts listening for the browser's install offer. Call once, early in boot: the event fires soon after load. */
export function installAppInstallPromptCapture(win: InstallWindowLike | null = targetWindow()): () => void {
  if (!win) return () => {};
  if (detach) return detach;
  const onBeforeInstallPrompt = (event: Event) => {
    if (!isInstallPromptEvent(event)) return;
    // Keep the offer for the hint instead of the browser's own mini-infobar; the address-bar install icon stays.
    event.preventDefault();
    deferredPrompt = event;
    log.debug('Browser offers installing MasterSelects as an app');
    publish();
  };
  const onAppInstalled = () => {
    deferredPrompt = null;
    installedThisVisit = true;
    log.info('MasterSelects was installed as an app; folder access now persists in the app window');
    publish();
  };
  win.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  win.addEventListener('appinstalled', onAppInstalled);
  const release = () => {
    win.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    win.removeEventListener('appinstalled', onAppInstalled);
    if (detach === release) detach = null;
  };
  detach = release;
  return release;
}

export function getAppInstallState(): AppInstallState {
  return snapshot;
}

export function subscribeAppInstallState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Hides the install hint on this device. */
export function dismissAppInstallHint(): void {
  dismissed = true;
  try {
    targetWindow()?.localStorage?.setItem(DISMISS_STORAGE_KEY, '1');
  } catch (error) {
    log.debug('Install hint dismissal is not remembered: storage unavailable', error);
  }
  publish();
}

/**
 * Shows the browser's install dialog. Must run inside a user click. The offer can be used once;
 * the browser may offer it again later, which the capture picks up.
 */
export async function promptAppInstall(): Promise<AppInstallOutcome> {
  const event = deferredPrompt;
  if (!event) {
    log.warn('Install requested, but the browser has not offered installing MasterSelects');
    return 'unavailable';
  }
  deferredPrompt = null;
  publish();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    log.info(`Install prompt ${choice.outcome}`);
    if (choice.outcome === 'accepted') {
      installedThisVisit = true;
      publish();
    }
    return choice.outcome;
  } catch (error) {
    log.warn('Install prompt failed', error);
    return 'failed';
  }
}

/** Test-only reset of module state. */
export function resetAppInstallPromptForTests(): void {
  detach?.();
  deferredPrompt = null;
  installedThisVisit = false;
  dismissed = readDismissed();
  snapshot = computeState();
  listeners.clear();
}

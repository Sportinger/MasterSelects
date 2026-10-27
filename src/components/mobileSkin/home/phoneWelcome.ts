// First-run welcome of the phone home: shown until the person starts or skips it, remembered on this
// device (localStorage, a per-device convenience), and shown again from Settings > Help. Without
// storage it shows each visit and can still be dismissed for the session; it never blocks the home.
import { useSyncExternalStore } from 'react';
import { Logger } from '../../../services/logger';
import { PHONE_WELCOME_STORAGE_KEY } from './phoneHomeTestIds';

export { PHONE_WELCOME_STORAGE_KEY };

const log = Logger.create('PhoneWelcome');

let dismissedThisSession = false;
const listeners = new Set<() => void>();

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(PHONE_WELCOME_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function isPhoneWelcomeDue(): boolean {
  return !dismissedThisSession && !readSeen();
}

/** Start or Skip: hide the welcome and remember it on this device. */
export function dismissPhoneWelcome(): void {
  dismissedThisSession = true;
  try {
    window.localStorage.setItem(PHONE_WELCOME_STORAGE_KEY, '1');
  } catch (error) {
    log.info('The welcome stays dismissed for this visit only: storage is unavailable', error);
  }
  notify();
}

/** Settings > Help > Show the welcome again. */
export function resetPhoneWelcome(): void {
  dismissedThisSession = false;
  try {
    window.localStorage.removeItem(PHONE_WELCOME_STORAGE_KEY);
  } catch (error) {
    log.info('Could not clear the remembered welcome', error);
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePhoneWelcomeDue(): boolean {
  return useSyncExternalStore(subscribe, isPhoneWelcomeDue, () => false);
}

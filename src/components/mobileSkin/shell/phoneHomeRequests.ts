// "Show the phone home screen" requests: a module-level listener set PhoneApp subscribes to. Kept
// apart from the project sheet so the top bar and the app shell do not load that sheet at start.

import { Logger } from '../../../services/logger';

const log = Logger.create('PhoneHomeRequests');
const homeListeners = new Set<() => void>();

/** Subscribe to "show the phone home screen" requests; returns the unsubscribe function. */
export function subscribePhoneHomeRequests(callback: () => void): () => void {
  homeListeners.add(callback);
  return () => {
    homeListeners.delete(callback);
  };
}

/** Ask the phone UI to show its home (project list) screen. */
export function requestPhoneHome(): void {
  if (homeListeners.size === 0) log.warn('Phone home requested, but no home screen is listening');
  for (const listener of [...homeListeners]) listener();
}

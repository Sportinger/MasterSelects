import { afterEach, expect, it } from 'vitest';
import { getRecentRuntimeDiagnosticEntries, installRuntimeDiagnostics } from '../../src/services/runtimeDiagnostics';
import { subscribeEditRejections, type EditRejection } from '../../src/services/editRejection';
import { RepositoryError } from '../../src/services/project/repository/contracts';

// Production: "Uncaught RepositoryError: This project is read-only…",
// "Project activation or handoff is in progress" and "Editor content projection
// is being activated" escaped UI handlers and were reported as crashes.
const received: EditRejection[] = [];
let unsubscribe = subscribeEditRejections(rejection => received.push(rejection));
afterEach(() => { received.length = 0; unsubscribe(); unsubscribe = subscribeEditRejections(rejection => received.push(rejection)); });

it('turns an uncaught ownership rejection into a warning and a notice', () => {
  installRuntimeDiagnostics();
  const error = new RepositoryError('ownership', 'This project is read-only. Close the other writing tab or grant folder access before editing.');
  const event = new ErrorEvent('error', { error, message: `Uncaught ${error.name}: ${error.message}`, cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(getRecentRuntimeDiagnosticEntries(1)[0]).toMatchObject({
    source: 'window-error', level: 'WARN', message: `Edit not applied: ${error.message}`, details: { code: 'ownership' },
  });
  expect(received.map(item => item.message)).toEqual([error.message]);
});

it('handles rejected promises from async edits the same way', () => {
  installRuntimeDiagnostics();
  const error = new RepositoryError('ownership', 'Editor content projection is being activated');
  const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: error });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(getRecentRuntimeDiagnosticEntries(1)[0]).toMatchObject({ source: 'unhandledrejection', level: 'WARN' });
  expect(received).toHaveLength(1);
});

it('keeps other repository failures as errors', () => {
  installRuntimeDiagnostics();
  const error = new RepositoryError('corrupt', 'Segment checksum mismatch');
  const event = new ErrorEvent('error', { error, message: error.message, cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(getRecentRuntimeDiagnosticEntries(1)[0]).toMatchObject({ source: 'window-error', level: 'ERROR' });
  expect(received).toHaveLength(0);
});

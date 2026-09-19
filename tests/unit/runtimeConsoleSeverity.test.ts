import { expect, it } from 'vitest';
import { getRecentRuntimeDiagnosticEntries, installRuntimeDiagnostics } from '../../src/services/runtimeDiagnostics';

const initialization = 'INFO: Created TensorFlow Lite XNNPACK delegate for CPU.';

it('retains the known TFLite initialization as informational evidence', () => {
  installRuntimeDiagnostics();
  console.error(initialization);
  expect(getRecentRuntimeDiagnosticEntries(1)[0]).toMatchObject({
    source: 'console', message: initialization, level: 'INFO', details: { method: 'error' },
  });
});

it('preserves errors accompanying the initialization text', () => {
  installRuntimeDiagnostics();
  console.error(initialization, new Error('Model preparation failed'));
  expect(getRecentRuntimeDiagnosticEntries(1)[0]).toMatchObject({
    level: 'ERROR', details: { method: 'error', errorName: 'Error' },
  });
});

it('does not downgrade arbitrary INFO prefixes on the error channel', () => {
  installRuntimeDiagnostics();
  console.error('INFO: another subsystem failed');
  expect(getRecentRuntimeDiagnosticEntries(1)[0]).toMatchObject({ level: 'ERROR' });
});

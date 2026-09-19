/**
 * Earliest possible diagnostics hook. This module must stay the FIRST import
 * of `main.tsx`: ES modules evaluate depth-first in import order, so anything
 * imported after it (RootApp, stores, engine) already runs under the console
 * patch, the window error listeners, and the server reporter.
 */
import { installRuntimeDiagnostics } from './services/runtimeDiagnostics';
import { installRuntimeDiagnosticReporting } from './services/diagnostics/diagnosticReporter';

installRuntimeDiagnostics();
installRuntimeDiagnosticReporting();

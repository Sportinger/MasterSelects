// Must stay the first import: installs console/error capture and the server
// reporter before any other module evaluates.
import './bootDiagnostics'
import './runtime/arrayCopySorting'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/themes/resolve.css'
import './styles/base.css'
import RootApp from './RootApp.tsx'
import { preloadEditorRuntime } from './editorEntryLoader'
import {
  canonicalEntryPath,
  ensureDirectEntryReturnsToLanding,
  resolveEntryExperience,
} from './routing/entryExperience'
import { installChunkLoadRecovery } from './runtime/chunkLoadRecovery'
import { createReactRootErrorHandlers } from './services/diagnostics/diagnosticReporter'

installChunkLoadRecovery();

const initialExperience = resolveEntryExperience(window.location);
const canonicalPath = canonicalEntryPath(window.location);

if (canonicalPath && window.location.pathname !== canonicalPath) {
  window.history.replaceState(
    window.history.state,
    '',
    `${canonicalPath}${window.location.search}${window.location.hash}`,
  );
}

ensureDirectEntryReturnsToLanding(window.location, window.history);

if (
  initialExperience === 'editor'
  || initialExperience === 'chat'
  || initialExperience === 'medium'
) {
  void preloadEditorRuntime();
}

// Note: StrictMode disabled for WebGPU compatibility in development
// StrictMode causes double-mounting which breaks external texture references
createRoot(document.getElementById('root')!, createReactRootErrorHandlers())
  .render(<RootApp initialExperience={initialExperience} />)

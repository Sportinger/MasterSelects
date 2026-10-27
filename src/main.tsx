// Must stay the first import: installs console/error capture and the server
// reporter before any other module evaluates.
import './bootDiagnostics'
import './runtime/arrayCopySorting'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/themes/resolve.css'
import './styles/base.css'
import RootApp from './RootApp.tsx'
import { preloadEditorRuntime, preloadPhoneRuntime } from './editorEntryLoader'
import {
  canonicalEntryPath,
  ensureDirectEntryReturnsToLanding,
  resolveEntryExperience,
} from './routing/entryExperience'
import { installChunkLoadRecovery, recoverFromChunkRenderError } from './runtime/chunkLoadRecovery'
import { createReactRootErrorHandlers } from './services/diagnostics/diagnosticReporter'
import { configureInspectorGraphWorker } from './services/operators/inspectorGraphClient'
import { installAppInstallPromptCapture } from './services/pwa/appInstallPrompt'

configureInspectorGraphWorker(() => new Worker(new URL('./workers/inspectorGraphWorker.ts', import.meta.url), { type: 'module' }));

installChunkLoadRecovery();
// The browser's install offer fires soon after load; keep it for the install hint in folder-access dialogs.
installAppInstallPromptCapture();

document.addEventListener('pointerdown', () => {
  document.documentElement.classList.add('pointer-focus');
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') document.documentElement.classList.remove('pointer-focus');
}, true);

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
} else if (initialExperience === 'phone') {
  // The phone skin never imports the desktop App; it boots the same editor services.
  void preloadPhoneRuntime();
}

// Note: StrictMode disabled for WebGPU compatibility in development
// StrictMode causes double-mounting which breaks external texture references
const rootErrorHandlers = createReactRootErrorHandlers()
createRoot(document.getElementById('root')!, {
  ...rootErrorHandlers,
  onUncaughtError: (error, errorInfo) => {
    rootErrorHandlers.onUncaughtError(error, errorInfo)
    recoverFromChunkRenderError(error)
  },
})
  .render(<RootApp initialExperience={initialExperience} />)

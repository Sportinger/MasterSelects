import { setClipStemSeparationRunner, useTimelineStore } from './stores/timeline';
import { AI_TOOLS, executeAITool, getQuickTimelineSummary } from './services/aiTools';
import { isFileSystemAccessSupported } from './services/fileSystemService';
import { NativeHelperClient } from './services/nativeHelper/NativeHelperClient';
import { useSettingsStore } from './stores/settingsStore';
import { installRuntimeDiagnostics } from './services/runtimeDiagnostics';
import { getStemSeparationService } from './services/audio/stemSeparation';
import { startEditorAgentTimelinePersistence } from './services/agentTimeline/runtime/persistence/editorPersistenceBootstrap';
import { ensureMetronomeScheduler } from './services/audio/metronomeScheduler';

installRuntimeDiagnostics();
startEditorAgentTimelinePersistence();

function warmNativeHelperForProjectBackend(): void {
  if (typeof window === 'undefined' || isFileSystemAccessSupported()) {
    return;
  }

  const {
    turboModeEnabled,
    nativeHelperPort,
    setNativeHelperConnected,
  } = useSettingsStore.getState();

  if (!turboModeEnabled) {
    return;
  }

  NativeHelperClient.configure({ port: nativeHelperPort });
  NativeHelperClient.onStatusChange((status) => {
    setNativeHelperConnected(status === 'connected');
  });

  void NativeHelperClient.connect()
    .then((connected) => setNativeHelperConnected(connected))
    .catch(() => setNativeHelperConnected(false));
}

warmNativeHelperForProjectBackend();

setClipStemSeparationRunner((request) => getStemSeparationService().separateClip(request));

// The metronome subscribes to the transport globally; this just guarantees the
// one-time init. It lives here rather than in a timeline hook because it is an
// app-wide audio service, not part of layer sync (#299).
ensureMetronomeScheduler();

// Expose AI tools API for browser console, Claude skills, and external agents
// Only available in development mode to prevent production exposure
if (import.meta.env.DEV) {
  (window as Window & {
    aiTools?: {
      execute: (tool: string, args: Record<string, unknown>) => ReturnType<typeof executeAITool>;
      list: () => typeof AI_TOOLS;
      status: typeof getQuickTimelineSummary;
    };
  }).aiTools = {
    execute: (tool: string, args: Record<string, unknown>) => executeAITool(tool, args, 'console'),
    list: () => AI_TOOLS,
    status: getQuickTimelineSummary,
  };

  // The HTTP/MCP bridge is a local development interface. External agents
  // bring their own model and harness; production builds do not expose it.
  void import('./services/aiTools/bridge');
}

// Expose store for debugging
if (import.meta.env.DEV) {
  (window as unknown as { store: typeof useTimelineStore }).store = useTimelineStore;
}

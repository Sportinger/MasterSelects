import { useTimelineStore } from './stores/timeline';
import { AI_TOOLS, executeAITool, getQuickTimelineSummary } from './services/aiTools';
import { isFileSystemAccessSupported } from './services/fileSystemService';
import { NativeHelperClient } from './services/nativeHelper/NativeHelperClient';
import { useSettingsStore } from './stores/settingsStore';

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
}

// Bridge: allow external agents to call aiTools via HTTP POST /api/ai-tools
void import('./services/aiTools/bridge');

// Expose store for debugging
if (import.meta.env.DEV) {
  (window as unknown as { store: typeof useTimelineStore }).store = useTimelineStore;
}

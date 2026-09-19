let editorAppModulePromise: Promise<typeof import('./App')> | null = null;
let editorBootModulePromise: Promise<typeof import('./editorBoot')> | null = null;
let editorBootScheduled = false;

export function loadEditorAppModule(): Promise<typeof import('./App')> {
  editorAppModulePromise ??= import('./App');
  return editorAppModulePromise;
}

function scheduleEditorBoot(editorAppModule: Promise<typeof import('./App')>): void {
  if (editorBootScheduled) return;
  editorBootScheduled = true;

  void editorAppModule
    .then(() => {
      const startBoot = () => {
        editorBootModulePromise ??= import('./editorBoot');
        void editorBootModulePromise.catch((error) => {
          console.error('[EditorBoot] Failed to initialize editor services.', error);
        });
      };

      // The editor shell is usable before these global side effects finish.
      // Give React one frame to paint before parsing the AI bridge/tool graph.
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(startBoot);
        return;
      }
      startBoot();
    })
    .catch(() => undefined);
}

export function preloadEditorRuntime(): Promise<typeof import('./App')> {
  const editorAppModule = loadEditorAppModule();
  scheduleEditorBoot(editorAppModule);
  return editorAppModule;
}

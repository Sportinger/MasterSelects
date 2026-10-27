let editorAppModulePromise: Promise<typeof import('./App')> | null = null;
let phoneAppModulePromise: Promise<typeof import('./components/mobileSkin/PhoneApp')> | null = null;
let editorBootModulePromise: Promise<typeof import('./editorBoot')> | null = null;
let editorBootScheduled = false;

export function loadEditorAppModule(): Promise<typeof import('./App')> {
  editorAppModulePromise ??= import('./App');
  return editorAppModulePromise;
}

export function loadPhoneAppModule(): Promise<typeof import('./components/mobileSkin/PhoneApp')> {
  phoneAppModulePromise ??= import('./components/mobileSkin/PhoneApp');
  return phoneAppModulePromise;
}

// Both entry shells (desktop App and the /m phone skin) share one once-only editorBoot.
function scheduleEditorBoot(entryModule: Promise<unknown>): void {
  if (editorBootScheduled) return;
  editorBootScheduled = true;

  void entryModule
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

export function preloadPhoneRuntime(): Promise<typeof import('./components/mobileSkin/PhoneApp')> {
  const phoneAppModule = loadPhoneAppModule();
  scheduleEditorBoot(phoneAppModule);
  return phoneAppModule;
}

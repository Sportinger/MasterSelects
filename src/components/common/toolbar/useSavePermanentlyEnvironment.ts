import { useEffect, useState } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import { ensurePersistentStorage, isFsaPickerAvailable } from '../../../services/project/core/projectRootAccess';
import { canUsePersistentBrowserStorage } from '../../../services/project/permanentSave/browserStorageMigration';
import { isMobileAppleWebKit } from '../../../utils/mobileAppleWebKit';

/** null while unknown; `unsupported` when the browser has no persistence API. */
export type StoragePersistence = boolean | 'unsupported' | null;

export interface SavePermanentlyEnvironment {
  checking: boolean;
  folderPicker: boolean;
  nativeHelper: boolean;
  persistentBrowserStorage: boolean;
  persistence: StoragePersistence;
  appleMobile: boolean;
  requestPersistence(): Promise<boolean>;
  recheck(): void;
}

async function readPersistence(): Promise<StoragePersistence> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persisted !== 'function') return 'unsupported';
  try { return await navigator.storage.persisted(); } catch { return null; }
}

/** What this device offers for Save permanently, checked when the dialog opens. */
export function useSavePermanentlyEnvironment(): SavePermanentlyEnvironment {
  const [state, setState] = useState(() => ({
    checking: true, folderPicker: isFsaPickerAvailable(), nativeHelper: false,
    persistentBrowserStorage: false, persistence: null as StoragePersistence,
  }));
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const folderPicker = isFsaPickerAvailable();
      // Without a folder picker, a running Native Helper still saves into real folders.
      const [route, persistentBrowserStorage, persistence] = await Promise.all([
        folderPicker ? Promise.resolve('folder-picker') : projectFileService.resolveOpenProjectRoute().catch(() => 'unavailable'),
        canUsePersistentBrowserStorage(),
        readPersistence(),
      ]);
      if (!cancelled) setState({ checking: false, folderPicker, nativeHelper: route === 'native-helper', persistentBrowserStorage, persistence });
    })();
    return () => { cancelled = true; };
  }, [generation]);

  return {
    ...state,
    appleMobile: isMobileAppleWebKit(),
    async requestPersistence() {
      const granted = await ensurePersistentStorage();
      setState(previous => ({ ...previous, persistence: granted }));
      return granted;
    },
    recheck: () => setGeneration(value => value + 1),
  };
}

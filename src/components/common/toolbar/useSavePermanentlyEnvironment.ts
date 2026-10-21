import { useEffect, useState } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import { ensurePersistentStorage, isFsaPickerAvailable } from '../../../services/project/core/projectRootAccess';
import { canUsePersistentBrowserStorage } from '../../../services/project/permanentSave/browserStorageMigration';
import type { StoragePersistence } from '../../../services/project/permanentSave/permanentSaveOptions';
import { readStoragePersistence } from '../../../services/project/permanentSave/storagePersistence';
import { isMobileAppleWebKit, resolveAppleHomeScreenMode, type AppleHomeScreenMode } from '../../../utils/mobileAppleWebKit';

export interface SavePermanentlyEnvironment {
  checking: boolean;
  folderPicker: boolean;
  nativeHelper: boolean;
  persistentBrowserStorage: boolean;
  persistence: StoragePersistence;
  appleMobile: boolean;
  /** iPhone/iPad browser tab (storage Safari may evict) or Home Screen app. */
  homeScreen: AppleHomeScreenMode;
  requestPersistence(): Promise<boolean>;
  recheck(): void;
}

/** What this device offers for Save permanently, checked when the dialog opens. */
export function useSavePermanentlyEnvironment(): SavePermanentlyEnvironment {
  const [state, setState] = useState(() => ({
    checking: true, folderPicker: isFsaPickerAvailable(), nativeHelper: false,
    persistentBrowserStorage: false, persistence: null as StoragePersistence,
  }));
  const [generation, setGeneration] = useState(0);
  const [homeScreen] = useState(() => resolveAppleHomeScreenMode());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const folderPicker = isFsaPickerAvailable();
      // Without a folder picker, a running Native Helper still saves into real folders.
      const [route, persistentBrowserStorage, persistence] = await Promise.all([
        folderPicker ? Promise.resolve('folder-picker') : projectFileService.resolveOpenProjectRoute().catch(() => 'unavailable'),
        canUsePersistentBrowserStorage(),
        readStoragePersistence(),
      ]);
      if (!cancelled) setState({ checking: false, folderPicker, nativeHelper: route === 'native-helper', persistentBrowserStorage, persistence });
    })();
    return () => { cancelled = true; };
  }, [generation]);

  return {
    ...state,
    appleMobile: isMobileAppleWebKit(),
    homeScreen,
    async requestPersistence() {
      const granted = await ensurePersistentStorage();
      setState(previous => ({ ...previous, persistence: granted }));
      return granted;
    },
    recheck: () => setGeneration(value => value + 1),
  };
}

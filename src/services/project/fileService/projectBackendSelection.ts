import { Logger } from '../../logger';
import { NativeHelperClient } from '../../nativeHelper/NativeHelperClient';
import { canHostNativeHelper } from '../core/browserStorageFailure';
import { NativeFileStorageService, nativeFileStorageService } from '../core/NativeFileStorageService';
import { NativeProjectCoreService } from '../core/NativeProjectCoreService';

const log = Logger.create('ProjectFileService');

export type ProjectBackend = 'fsa' | 'native';

/**
 * Which project file backend serves non-repository file operations: the browser (FSA/OPFS)
 * or the Native Helper. The native services are created on first use and kept afterwards;
 * a helper that cannot serve project files never stays selected.
 */
export class ProjectBackendSelection {
  private active: ProjectBackend = 'fsa';
  private nativeCore: NativeProjectCoreService | null = null;
  private nativeFiles: NativeFileStorageService | null = null;

  get backend(): ProjectBackend { return this.active; }
  get nativeCoreService(): NativeProjectCoreService | null { return this.nativeCore; }
  get nativeFileStorage(): NativeFileStorageService | null { return this.nativeFiles; }

  /** Selects the Native Helper backend, creating its services on first use. */
  selectNative(): NativeProjectCoreService {
    if (!this.nativeCore) {
      this.nativeCore = new NativeProjectCoreService();
      this.nativeFiles = nativeFileStorageService;
    }
    this.active = 'native';
    return this.nativeCore;
  }

  selectFsa(): void { this.active = 'fsa'; }

  /**
   * Selects the Native Helper only when it is connected and serves project file commands;
   * otherwise the previous backend stays selected and null is returned.
   */
  async selectReadyNative(): Promise<NativeProjectCoreService | null> {
    if (!canHostNativeHelper()) return null; // iOS/Android: browser storage only, logged once
    const previous = this.active;
    const nativeCore = this.selectNative();
    const abandon = (): null => { this.active = previous; return null; };
    if (!NativeHelperClient.isConnected() && !await NativeHelperClient.connect()) {
      log.warn('Native Helper backend requested but helper is not connected');
      return abandon();
    }
    if (!await NativeHelperClient.hasFsCommands()) {
      log.error('Native Helper does not support project file-system commands');
      return abandon();
    }
    return nativeCore;
  }
}

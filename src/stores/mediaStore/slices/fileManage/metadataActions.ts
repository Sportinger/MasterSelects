import type { MediaSliceCreator } from '../../types';
import type { FileManageActions } from '../fileManageSlice';

export const createFileMetadataActions: MediaSliceCreator<Pick<
  FileManageActions,
  'renameFile' | 'removeSignalAsset' | 'renameSignalAsset'
>> = (set) => ({
  renameFile: (id: string, name: string) => {
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, name } : f)),
    }));
  },

  removeSignalAsset: (id: string) => {
    set((state) => ({
      signalAssets: state.signalAssets.filter((item) => item.id !== id),
      selectedIds: state.selectedIds.filter((sid) => sid !== id),
    }));
  },

  renameSignalAsset: (id: string, name: string) => {
    set((state) => ({
      signalAssets: state.signalAssets.map((item) => (
        item.id === id
          ? {
              ...item,
              name,
              asset: {
                ...item.asset,
                name,
                updatedAt: new Date().toISOString(),
              },
            }
          : item
      )),
    }));
  },
});

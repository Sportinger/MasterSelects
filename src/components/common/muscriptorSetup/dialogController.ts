const OPEN_MUSCRIPTOR_DIALOG_EVENT = 'masterselects:open-muscriptor-dialog';

export interface OpenMuscriptorDialogDetail {
  sourceClipId?: string;
}

/** Open the global MuScriptor setup/run dialog from timeline or settings UI. */
export function openMuscriptorDialog(sourceClipId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenMuscriptorDialogDetail>(
    OPEN_MUSCRIPTOR_DIALOG_EVENT,
    { detail: sourceClipId ? { sourceClipId } : {} },
  ));
}

export function subscribeMuscriptorDialogOpen(
  listener: (detail: OpenMuscriptorDialogDetail) => void,
): () => void {
  const handleOpen = (event: Event) => {
    listener((event as CustomEvent<OpenMuscriptorDialogDetail>).detail ?? {});
  };
  window.addEventListener(OPEN_MUSCRIPTOR_DIALOG_EVENT, handleOpen);
  return () => window.removeEventListener(OPEN_MUSCRIPTOR_DIALOG_EVENT, handleOpen);
}

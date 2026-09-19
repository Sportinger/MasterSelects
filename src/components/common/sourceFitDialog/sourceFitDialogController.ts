export type SourceFitDecision = 'fit' | 'stretch' | 'original';

export interface SourceFitDialogRequest {
  mediaName: string;
  sourceWidth: number;
  sourceHeight: number;
  compositionWidth: number;
  compositionHeight: number;
}

export interface PendingSourceFitDialogRequest extends SourceFitDialogRequest {
  resolve: (decision: SourceFitDecision) => void;
}

const OPEN_SOURCE_FIT_DIALOG_EVENT = 'masterselects:open-source-fit-dialog';

export function requestSourceFitDecision(
  request: SourceFitDialogRequest,
): Promise<SourceFitDecision> {
  if (typeof window === 'undefined') return Promise.resolve('original');

  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<PendingSourceFitDialogRequest>(
      OPEN_SOURCE_FIT_DIALOG_EVENT,
      { detail: { ...request, resolve } },
    ));
  });
}

export function subscribeSourceFitDialogOpen(
  listener: (request: PendingSourceFitDialogRequest) => void,
): () => void {
  const handleOpen = (event: Event) => {
    listener((event as CustomEvent<PendingSourceFitDialogRequest>).detail);
  };
  window.addEventListener(OPEN_SOURCE_FIT_DIALOG_EVENT, handleOpen);
  return () => window.removeEventListener(OPEN_SOURCE_FIT_DIALOG_EVENT, handleOpen);
}

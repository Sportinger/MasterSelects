const OPEN_RELINK_DIALOG_EVENT = 'masterselects:open-relink-dialog';

export function requestRelinkDialog(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_RELINK_DIALOG_EVENT));
}

export function subscribeRelinkDialogRequests(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(OPEN_RELINK_DIALOG_EVENT, listener);
  return () => window.removeEventListener(OPEN_RELINK_DIALOG_EVENT, listener);
}

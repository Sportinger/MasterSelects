export const OPEN_NATIVE_HELPER_DIALOG_EVENT = 'openNativeHelperDialog';

export function openNativeHelperDialog() {
  window.dispatchEvent(new Event(OPEN_NATIVE_HELPER_DIALOG_EVENT));
}

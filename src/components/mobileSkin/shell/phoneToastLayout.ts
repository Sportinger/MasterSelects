// Pure rules of the phone toast: how long it stays and where it goes while a sheet is open
// (PhoneToast.tsx measures, these decide).

/** Info toasts stay at least 2.5 s, errors at least 4 s; longer messages stay long enough to be read. */
const TOAST_MS = { info: 2500, error: 4000 } as const;
const TOAST_READ_MS = { base: 1200, perChar: 55, max: 9000 } as const;

/** How long a toast stays: its minimum by tone, or longer for a long message (reading time). */
export function phoneToastDuration(toast: { message: string; tone: 'info' | 'error' }): number {
  const reading = TOAST_READ_MS.base + toast.message.length * TOAST_READ_MS.perChar;
  return Math.min(TOAST_READ_MS.max, Math.max(TOAST_MS[toast.tone], reading));
}

export interface PhoneToastFit {
  placement: 'beside-tab' | 'row';
  /** True when even the whole row is too narrow for one line: the toast wraps down over the preview. */
  wrap: boolean;
}

/**
 * Where an info toast goes while a sheet is open. `natural` is its one-line width, `besideRoom` the room
 * beside the active composition tab (null when there is none), `rowRoom` the full row width. A message is
 * never cut to an ellipsis: if it fits nowhere on one line, it wraps.
 */
export function phoneToastFit(natural: number, besideRoom: number | null, rowRoom: number): PhoneToastFit {
  if (besideRoom !== null && natural <= besideRoom) return { placement: 'beside-tab', wrap: false };
  return { placement: 'row', wrap: natural > rowRoom };
}

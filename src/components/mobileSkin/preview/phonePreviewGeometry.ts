// Where the composition sits inside the phone preview: aspect-fit, or actual pixels (one
// composition pixel per CSS pixel, like the desktop preview's 1:1) with a pan offset. Every phone
// overlay (handles, rulers, guides, compare line) is laid over this one rectangle.

export interface PhoneSize {
  width: number;
  height: number;
}

export interface PhoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitPhoneSize(container: PhoneSize, aspect: number): PhoneSize {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) return { width: 0, height: 0 };
  if (container.width / container.height > aspect) {
    return { width: Math.floor(container.height * aspect), height: Math.floor(container.height) };
  }
  return { width: Math.floor(container.width), height: Math.floor(container.width / aspect) };
}

/** How far the actual-pixels view may pan: the picture may leave a quarter of the view empty, no more. */
export function clampPhonePan(pan: { x: number; y: number }, display: PhoneSize, container: PhoneSize): { x: number; y: number } {
  const limit = (picture: number, view: number) => Math.max(0, (picture - view) / 2) + view * 0.25;
  const lx = limit(display.width, container.width);
  const ly = limit(display.height, container.height);
  return { x: Math.max(-lx, Math.min(lx, pan.x)), y: Math.max(-ly, Math.min(ly, pan.y)) };
}

/** Display size and position of the composition inside the preview container (CSS pixels). */
export function phoneCanvasRect(container: PhoneSize, comp: PhoneSize, actual: boolean, pan: { x: number; y: number }): PhoneRect {
  const display = actual ? { width: comp.width, height: comp.height } : fitPhoneSize(container, comp.width / comp.height);
  const offset = actual ? clampPhonePan(pan, display, container) : { x: 0, y: 0 };
  return {
    x: (container.width - display.width) / 2 + offset.x,
    y: (container.height - display.height) / 2 + offset.y,
    width: display.width,
    height: display.height,
  };
}

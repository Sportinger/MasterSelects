const LAYER_NUDGE_OWNED_CONTROL_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="textbox"]',
].join(',');

/** Focused authoring controls own their arrow keys before viewport layer nudge. */
export function shouldDeferLayerNudgeToFocusedControl(active: Element | null): boolean {
  return Boolean(active?.closest(LAYER_NUDGE_OWNED_CONTROL_SELECTOR));
}

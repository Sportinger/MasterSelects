import type { ShortcutActionId } from './shortcutTypes';

interface ClaimShortcutOptions {
  allowInTextEntry?: boolean;
  blurFocusedControl?: boolean;
  deferToFocusedControl?: boolean;
  stopImmediatePropagation?: boolean;
  stopPropagation?: boolean;
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const SHORTCUT_CONTROL_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'separator',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);

const DIRECTIONAL_CONTROL_ROLES = new Set([
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'slider',
  'spinbutton',
  'tab',
  'treeitem',
]);

const CLAIMED_SHORTCUT_EVENTS = new WeakSet<KeyboardEvent>();

function asElement(target: EventTarget | null): Element | null {
  if (
    target &&
    typeof (target as Element).closest === 'function' &&
    typeof (target as Element).tagName === 'string'
  ) {
    return target as Element;
  }
  return null;
}

function getFocusedElement(fallbackTarget: EventTarget | null): HTMLElement | null {
  const target = asElement(fallbackTarget);
  const ownerDocument = target?.ownerDocument ?? document;
  const activeElement = ownerDocument.activeElement;
  if (
    activeElement &&
    activeElement !== ownerDocument.body &&
    typeof (activeElement as HTMLElement).blur === 'function'
  ) {
    return activeElement as HTMLElement;
  }

  return target && typeof (target as HTMLElement).blur === 'function'
    ? target as HTMLElement
    : null;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element) return false;

  const textEntry = element.closest(
    'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]',
  );
  if (!textEntry) return false;

  if (textEntry.tagName.toLowerCase() === 'input') {
    return !NON_TEXT_INPUT_TYPES.has((textEntry as HTMLInputElement).type.toLowerCase());
  }

  return true;
}

export function isShortcutControlElement(element: Element | null): element is HTMLElement {
  if (!element || typeof (element as HTMLElement).blur !== 'function') return false;

  const role = element.getAttribute('role');
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === 'a' ||
    tagName === 'button' ||
    tagName === 'input' ||
    tagName === 'select' ||
    tagName === 'summary' ||
    (role !== null && SHORTCUT_CONTROL_ROLES.has(role))
  );
}

function isDirectionalControlElement(element: Element | null): boolean {
  if (!element) return false;

  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  if (tagName === 'select') return true;
  if (tagName === 'input') {
    const inputType = (element as HTMLInputElement).type.toLowerCase();
    return inputType === 'number' || inputType === 'radio' || inputType === 'range';
  }

  return role !== null && DIRECTIONAL_CONTROL_ROLES.has(role);
}

function shouldDeferToFocusedControl(
  event: KeyboardEvent,
  focusedElement: Element | null,
): boolean {
  if (!focusedElement) return false;

  const key = event.key.toLowerCase();
  if (
    isShortcutControlElement(focusedElement) &&
    (event.code === 'Space' || key === ' ' || key === 'enter')
  ) {
    return true;
  }

  return key.startsWith('arrow') && isDirectionalControlElement(focusedElement);
}

export function claimKeyboardEvent(
  event: KeyboardEvent,
  options: ClaimShortcutOptions = {},
): boolean {
  if (event.defaultPrevented || CLAIMED_SHORTCUT_EVENTS.has(event)) return false;

  const focusedElement = getFocusedElement(event.target);
  if (
    !options.allowInTextEntry &&
    (isTextEntryTarget(event.target) || isTextEntryTarget(focusedElement))
  ) {
    return false;
  }

  if (
    options.deferToFocusedControl !== false &&
    shouldDeferToFocusedControl(event, focusedElement)
  ) {
    return false;
  }

  CLAIMED_SHORTCUT_EVENTS.add(event);
  event.preventDefault();
  if (options.blurFocusedControl && isShortcutControlElement(focusedElement)) {
    focusedElement.blur();
  }

  if (options.stopImmediatePropagation) {
    event.stopImmediatePropagation();
  } else if (options.stopPropagation) {
    event.stopPropagation();
  }

  return true;
}

export function claimShortcut(
  event: KeyboardEvent,
  _action: ShortcutActionId,
  options: ClaimShortcutOptions = {},
): boolean {
  return claimKeyboardEvent(event, options);
}

export function handoffPointerFocus(event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0) return;

  const target = asElement(event.target);
  const focusedElement = getFocusedElement(event.target);
  if (!focusedElement || !target || focusedElement.contains(target)) return;

  focusedElement.blur();
}

/**
 * Whether a node inspector starts open. On the desktop it always does. Inside the phone skin the
 * inspector would take most of a phone's width from the canvas, so it starts closed there and opens
 * from its handle as an overlay drawer (NodeTouchActions.css).
 */
export function nodeInspectorStartsOpen(): boolean {
  return !(typeof document !== 'undefined' && document.querySelector('.mobile-skin'));
}

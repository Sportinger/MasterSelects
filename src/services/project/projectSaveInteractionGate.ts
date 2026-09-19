/** Runtime-only input gate: continuous saves wait for the current gesture to end. */
export function createProjectSaveInteractionGate(target: EventTarget, onSettled: () => void) {
  const pointers = new Set<number>();
  let nativeDrag = false;
  let settledAt = -Infinity;
  const settle = () => { settledAt = Date.now(); onSettled(); };
  const active = () => pointers.size > 0 || nativeDrag;
  const down = (event: Event) => pointers.add((event as PointerEvent).pointerId ?? 0);
  const up = (event: Event) => {
    const wasActive = active();
    pointers.delete((event as PointerEvent).pointerId ?? 0);
    if (wasActive && !active()) settle();
  };
  const dragStart = () => { nativeDrag = true; };
  const finish = () => {
    const wasActive = active();
    pointers.clear(); nativeDrag = false;
    if (wasActive) settle();
  };
  const listeners: Array<[string, EventListener]> = [
    ['pointerdown', down], ['pointerup', up], ['pointercancel', up],
    ['dragstart', dragStart], ['dragend', finish], ['drop', finish], ['blur', finish],
  ];
  for (const [name, listener] of listeners) target.addEventListener(name, listener, true);
  return {
    isActive: active,
    remainingQuietMs: () => Math.max(0, 1500 - (Date.now() - settledAt)),
    dispose() {
      for (const [name, listener] of listeners) target.removeEventListener(name, listener, true);
      pointers.clear(); nativeDrag = false;
    },
  };
}

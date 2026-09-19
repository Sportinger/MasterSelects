import { describe, it, expect, vi } from 'vitest';
import { createProjectSaveInteractionGate } from '../../src/services/project/projectSaveInteractionGate';

function pointer(target: EventTarget, type: string, id: number) {
  const event = new Event(type); Object.defineProperty(event, 'pointerId', { value: id }); target.dispatchEvent(event);
}
describe('continuous save gesture gate', () => {
  it('waits for all pointers, including long stationary holds, before settling', () => {
    const target = new EventTarget(); const settled = vi.fn();
    const gate = createProjectSaveInteractionGate(target, settled);
    pointer(target, 'pointerdown', 1); pointer(target, 'pointerdown', 2);
    expect(gate.isActive()).toBe(true);
    pointer(target, 'pointerup', 1); expect(settled).not.toHaveBeenCalled();
    pointer(target, 'pointerup', 2); expect(gate.isActive()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1); gate.dispose();
  });
  it('releases on cancellation or lost focus and removes listeners on teardown', () => {
    const target = new EventTarget(); const settled = vi.fn();
    const gate = createProjectSaveInteractionGate(target, settled);
    pointer(target, 'pointerdown', 1); pointer(target, 'pointercancel', 1);
    expect(gate.isActive()).toBe(false);
    target.dispatchEvent(new Event('dragstart')); expect(gate.isActive()).toBe(true);
    target.dispatchEvent(new Event('blur')); expect(gate.isActive()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(2);
    gate.dispose(); pointer(target, 'pointerdown', 1); expect(gate.isActive()).toBe(false);
  });
});

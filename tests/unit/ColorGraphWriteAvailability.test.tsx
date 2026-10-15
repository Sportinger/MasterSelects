import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { TimelineClip } from '../../src/types/timeline';
import { createDefaultColorCorrectionState } from '../../src/types/colorCorrection';
const state = vi.hoisted(() => ({ writable: true, listeners: new Set<() => void>(),
  actions: { setColorCorrectionEnabled: vi.fn(), setColorCorrectionStackIndex: vi.fn(), removeColorCorrection: vi.fn(), setColorNodeEnabled: vi.fn(), activatePanelType: vi.fn() },
}));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: (pick: (s: unknown) => unknown) => pick(state.actions) }));
vi.mock('../../src/stores/dockStore', () => ({ useDockStore: (pick: (s: unknown) => unknown) => pick(state.actions) }));
vi.mock('../../src/services/nodeGraph/nodeWorkspaceNavigation', () => ({ requestNodeWorkspaceView: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/editorWriteAvailability', () => ({
  isEditorRepositoryWritable: () => state.writable,
  subscribeEditorWriteAvailability: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
}));
vi.mock('../../src/components/panels/color/ColorNodeParameterControls', () => ({
  ColorNodeParameterControls: ({ disabled }: { disabled: boolean }) => <input aria-label="Color value" disabled={disabled} />,
}));
vi.mock('../../src/components/panels/properties/resolveInspector/ResolveInspectorPrimitives', () => ({
  ResolveInspectorSection: ({ children, onEnabledChange }: { children: ReactNode; onEnabledChange?: (value: boolean) => void }) =>
    <section><button disabled={!onEnabledChange} onClick={() => onEnabledChange?.(false)}>Toggle node</button>{children}</section>,
}));
import { ColorGraphEffectEntry } from '../../src/components/panels/properties/ColorGraphEffectEntry';
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
beforeEach(() => { state.writable = true; vi.clearAllMocks(); });
afterEach(cleanup);
it('disables grade mutations when the writer is lost but allows inspecting the graph', () => {
  const clip = { id: 'clip', colorCorrection: { ...createDefaultColorCorrectionState(), enabled: true, stackIndex: 1 } } as TimelineClip;
  render(<ColorGraphEffectEntry clip={clip} visualEffectCount={2} />);
  expect(button('Remove Color').disabled).toBe(false);
  act(() => { state.writable = false; state.listeners.forEach(listener => listener()); });
  for (const name of ['Remove Color', 'Bypass Color', 'Move Color up', 'Move Color down']) {
    expect(button(name).disabled).toBe(true); fireEvent.click(button(name));
  }
  for (const input of screen.getAllByRole('textbox')) expect((input as HTMLInputElement).disabled).toBe(true);
  for (const node of screen.getAllByText('Toggle node')) expect((node as HTMLButtonElement).disabled).toBe(true);
  expect(state.actions.removeColorCorrection).not.toHaveBeenCalled();
  expect(state.actions.setColorCorrectionEnabled).not.toHaveBeenCalled();
  fireEvent.click(button('Open Color Graph in Nodes'));
  expect(state.actions.activatePanelType).toHaveBeenCalledWith('node-workspace');
  act(() => { state.writable = true; state.listeners.forEach(listener => listener()); });
  fireEvent.click(button('Remove Color')); expect(state.actions.removeColorCorrection).toHaveBeenCalledWith('clip');
});
it('releases pointer focus and preserves keyboard focus on graph navigation', () => {
  render(<ColorGraphEffectEntry clip={{ id: 'clip', colorCorrection: createDefaultColorCorrectionState() } as TimelineClip} visualEffectCount={0} />);
  const control = button('Open Color Graph in Nodes');
  control.focus(); fireEvent.pointerUp(control); expect(document.activeElement).not.toBe(control);
  control.focus(); fireEvent.keyUp(control, { key: 'Tab' }); expect(document.activeElement).toBe(control);
});

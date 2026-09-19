import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveInspectorNumberRow } from '../../src/components/panels/properties/resolveInspector/ResolveInspectorNumberRow';
import { saveEditableDraggableNumberSettings, dispatchEditableDraggableNumberSettingsUpdated } from '../../src/components/common/EditableDraggableNumberSettings';
import { defaultFaceCable, isFaceCableConfig, encodeCableBake, decodeCableBake, cableFrameLayout } from '../../src/services/faceCables/cableData';

vi.mock('../../src/components/panels/properties/LabeledValue', () => ({
  LabeledValue: ({ onChange }: { onChange: (value: number) => void }) =>
    <input aria-label="Typed value" onChange={event => onChange(Number(event.target.value))} />,
}));
afterEach(() => { cleanup(); localStorage.clear(); });
describe('shared inspector custom ranges', () => {
  it('updates the slider range and accepts typed values beyond the original maximum', () => {
    const changed = vi.fn();
    render(<ResolveInspectorNumberRow label="Length" value={3} defaultValue={1.6} min={1.05} max={3} step={0.05} persistenceKey="length" onChange={changed} />);
    act(() => {
      saveEditableDraggableNumberSettings('length', { min: 1.05, max: 30, defaultValue: 6 });
      dispatchEditableDraggableNumberSettingsUpdated('length');
    });
    expect(screen.getByRole('slider', { name: 'Length slider' }).getAttribute('aria-valuemax')).toBe('30');
    fireEvent.change(screen.getByRole('textbox', { name: 'Typed value' }), { target: { value: '20' } });
    expect(changed).toHaveBeenLastCalledWith(20);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Length' }));
    expect(changed).toHaveBeenLastCalledWith(6);
  });
  it('retains explicit technical limits', () => {
    saveEditableDraggableNumberSettings('segments', { max: 500 });
    const changed = vi.fn();
    render(<ResolveInspectorNumberRow label="Segments" value={24} defaultValue={24} min={4} max={96} hardMin={4} hardMax={96} step={1} persistenceKey="segments" onChange={changed} />);
    expect(screen.getByRole('slider').getAttribute('aria-valuemax')).toBe('96');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '500' } });
    expect(changed).toHaveBeenLastCalledWith(96);
  });
  it('round-trips extended cable settings through the bake format', () => {
    const cable = { ...defaultFaceCable(), slack: 30, windZ: 90, gravity: 12, damping: 25, width: 60 };
    expect(isFaceCableConfig(cable)).toBe(true);
    const data = new Float32Array(cableFrameLayout(3, [cable]).stride);
    const result = decodeCableBake(encodeCableBake({ version: 3, frames: 1, fps: 30, duration: 1, cables: [cable], data }));
    expect(result?.cables[0]).toEqual(cable);
    expect(isFaceCableConfig({ ...cable, slack: Infinity })).toBe(false);
    expect(isFaceCableConfig({ ...cable, width: -1 })).toBe(false);
  });
});

// The one Resolve colour row (effect colour parameters, Chroma Key's screen colour): swatch, editable
// hex field and reset; a stored alpha (#rrggbbaa) survives a swatch pick.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResolveInspectorColorRow } from '../../src/components/panels/properties/resolveInspector/ResolveInspectorColorRow';

afterEach(cleanup);

describe('Resolve colour row', () => {
  it('keeps the alpha of a stored colour when the swatch picks a new one', () => {
    const changed = vi.fn(), committed = vi.fn();
    render(<ResolveInspectorColorRow label="Grout Color" value="#11223380" defaultValue="#111827" onChange={changed} onCommit={committed} />);
    const swatch = screen.getByLabelText('Grout Color');
    expect(swatch).toHaveValue('#112233');
    expect(screen.getByLabelText('Grout Color hex')).toHaveValue('#11223380');
    fireEvent.change(swatch, { target: { value: '#AABBCC' } });
    expect(changed).toHaveBeenLastCalledWith('#aabbcc80');
    fireEvent.blur(swatch);
    expect(committed).toHaveBeenLastCalledWith('select');
  });

  it('takes 3, 6 or 8 hex digits, drops anything else and resets to the default', () => {
    const changed = vi.fn(), committed = vi.fn();
    render(<ResolveInspectorColorRow label="Screen" ariaLabel="Screen color" value="#2050c0" defaultValue="#00ff00" onChange={changed} onCommit={committed} />);
    const hex = screen.getByLabelText('Screen color hex');
    for (const [typed, stored] of [['f0a', '#ff00aa'], ['#12345678', '#12345678']]) {
      fireEvent.change(hex, { target: { value: typed } });
      fireEvent.keyDown(hex, { key: 'Enter' });
      expect(changed).toHaveBeenLastCalledWith(stored);
    }
    changed.mockClear();
    fireEvent.change(hex, { target: { value: 'nope' } });
    fireEvent.blur(hex);
    expect(changed).not.toHaveBeenCalled();
    expect(hex).toHaveValue('#2050c0');
    fireEvent.click(screen.getByLabelText('Reset Screen'));
    expect(changed).toHaveBeenLastCalledWith('#00ff00');
    expect(committed).toHaveBeenLastCalledWith('reset');
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NodeCompactLayoutButton } from '../../src/components/panels/nodes/canvas/NodeCompactLayoutButton';

afterEach(cleanup);
it('exposes toggle state and clears pointer focus while retaining keyboard focus', () => {
  const toggle = vi.fn();
  const view = render(<NodeCompactLayoutButton enabled onToggle={toggle} />);
  const button = screen.getByRole('button', { name: 'Compact', pressed: true });
  button.focus();
  fireEvent.click(button, { detail: 1 });
  expect(document.activeElement).not.toBe(button);
  view.rerender(<NodeCompactLayoutButton enabled={false} onToggle={toggle} />);
  expect(screen.getByRole('button', { name: 'Compact', pressed: false })).toBe(button);
  button.focus();
  fireEvent.click(button, { detail: 0 });
  expect(document.activeElement).toBe(button);
  expect(toggle).toHaveBeenCalledTimes(2);
});

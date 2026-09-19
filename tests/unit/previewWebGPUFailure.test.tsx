import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PreviewEngineFailureNotice } from '../../src/components/preview/PreviewEngineFailureNotice';

describe('PreviewEngineFailureNotice', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a prominent WebGPU failure without a browser recommendation', () => {
    render(<PreviewEngineFailureNotice error="No compatible GPU adapter was found." />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('preview-webgpu-failure');
    expect(screen.getByRole('heading', { name: 'WebGPU is not working' })).toBeTruthy();
    expect(alert.textContent).toContain('No compatible GPU adapter was found.');
    expect(alert.textContent).toContain('Vulkan');
    expect(alert.textContent).not.toContain('Chrome');
    expect(alert.textContent).not.toContain('Edge');
    expect(alert.textContent).not.toContain('Firefox');
    expect(alert.textContent).not.toContain('Safari');
  });
});

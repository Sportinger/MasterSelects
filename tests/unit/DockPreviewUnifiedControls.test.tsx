import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const previewProps = vi.hoisted(() => vi.fn());

vi.mock('../../src/components/preview/Preview', () => ({
  Preview: (props: Record<string, unknown>) => {
    previewProps(props);
    return <div data-testid="preview" />;
  },
}));

import { DockPanelContent } from '../../src/components/dock/DockPanelContent';

afterEach(() => {
  cleanup();
  previewProps.mockClear();
});

describe('docked Preview controls', () => {
  it('enables the same collapsible transport for every Preview layout', () => {
    render(
      <DockPanelContent
        allowPanelMaximize
        panel={{ id: 'preview-default', title: 'Preview', type: 'preview' }}
      />,
    );

    expect(previewProps).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'preview-default',
      showTransport: true,
    }));
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetachedPanelWindow } from '../../src/components/dock/DetachedPanelWindow';
import { useDockStore } from '../../src/stores/dockStore';
import type { BrowserWindowPanel } from '../../src/types/dock';

vi.mock('../../src/components/dock/DockPanelContent', () => ({
  DockPanelContent: () => <div>Detached content</div>,
}));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  window.sessionStorage.clear();
});

describe('DetachedPanelWindow', () => {
  it('closes the old popup while the main editor refreshes', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const popup = frame.contentWindow!;
    const closePopup = vi.spyOn(popup, 'close').mockImplementation(() => {});
    vi.spyOn(popup, 'focus').mockImplementation(() => {});
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const windowPanel: BrowserWindowPanel = {
      id: 'window-timeline-refresh-test',
      panel: { id: 'timeline', type: 'timeline', title: 'Timeline' },
      returnGroupId: 'timeline-group',
      size: { width: 800, height: 420 },
    };

    const view = render(<DetachedPanelWindow windowPanel={windowPanel} />);

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(closePopup).toHaveBeenCalledOnce();
    view.unmount();
    frame.remove();
  });

  it('reserves the popup before project boot and waits to mount its content', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const popup = frame.contentWindow!;
    vi.spyOn(popup, 'focus').mockImplementation(() => {});
    const openPopup = vi.spyOn(window, 'open').mockReturnValue(popup);
    const windowPanel: BrowserWindowPanel = {
      id: 'window-timeline-restore-test',
      panel: { id: 'timeline', type: 'timeline', title: 'Timeline' },
      returnGroupId: 'timeline-group',
      position: { left: 240, top: 130 },
      size: { width: 910, height: 460 },
    };

    const view = render(
      <DetachedPanelWindow restoreReady={false} windowPanel={windowPanel} />,
    );

    expect(openPopup).toHaveBeenCalledOnce();
    expect(popup.document.body.textContent).not.toContain('Detached content');

    view.rerender(
      <DetachedPanelWindow restoreReady windowPanel={windowPanel} />,
    );

    expect(openPopup).toHaveBeenCalledOnce();
    expect(openPopup.mock.calls[0]?.[2]).toContain('width=910');
    expect(openPopup.mock.calls[0]?.[2]).toContain('height=460');
    expect(openPopup.mock.calls[0]?.[2]).toContain('left=240');
    expect(openPopup.mock.calls[0]?.[2]).toContain('top=130');
    view.unmount();
    frame.remove();
  });

  it('keeps a blocked restore available for a user-gesture retry', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const popup = frame.contentWindow!;
    vi.spyOn(popup, 'focus').mockImplementation(() => {});
    const openPopup = vi.spyOn(window, 'open')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(popup);
    const windowPanel: BrowserWindowPanel = {
      id: 'window-timeline-blocked-restore-test',
      panel: { id: 'timeline', type: 'timeline', title: 'Timeline' },
      returnGroupId: 'timeline-group',
      position: { left: 180, top: 95 },
      size: { width: 840, height: 430 },
    };

    const view = render(<DetachedPanelWindow windowPanel={windowPanel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore Timeline window' }));

    expect(openPopup).toHaveBeenCalledTimes(2);
    expect(openPopup.mock.calls[1]?.[2]).toContain('width=840');
    expect(openPopup.mock.calls[1]?.[2]).toContain('height=430');
    view.unmount();
    frame.remove();
  });

  it('does not redock when the reserved popup document is replaced', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const popup = frame.contentWindow!;
    vi.spyOn(popup, 'focus').mockImplementation(() => {});
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const originalDock = useDockStore.getState().dockBrowserWindowPanel;
    const dockBrowserWindowPanel = vi.fn();
    useDockStore.setState({ dockBrowserWindowPanel });
    const windowPanel: BrowserWindowPanel = {
      id: 'window-timeline-document-replace-test',
      panel: { id: 'timeline', type: 'timeline', title: 'Timeline' },
      returnGroupId: 'timeline-group',
      size: { width: 800, height: 420 },
    };

    const view = render(
      <DetachedPanelWindow restoreReady={false} windowPanel={windowPanel} />,
    );

    popup.dispatchEvent(new Event('beforeunload'));

    expect(dockBrowserWindowPanel).not.toHaveBeenCalled();
    view.unmount();
    useDockStore.setState({ dockBrowserWindowPanel: originalDock });
    frame.remove();
  });
});

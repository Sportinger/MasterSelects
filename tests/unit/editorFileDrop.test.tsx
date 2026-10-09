import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ importDrop: vi.fn(), activate: vi.fn(), importFiles: vi.fn(), createFolder: vi.fn() }));
vi.mock('../../src/components/panels/media/importProjectDrop', () => ({ importProjectDrop: mocks.importDrop }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ folders: [], importFiles: mocks.importFiles, importFilesWithHandles: vi.fn(), createFolder: mocks.createFolder }) } }));
vi.mock('../../src/stores/dockStore', () => ({ useDockStore: { getState: () => ({ activatePanelType: mocks.activate }) } }));
import { EditorFileDrop } from '../../src/components/common/EditorFileDrop';
function transfer(types = ['Files']) { return { types, dropEffect: 'none', files: [new File(['x'], 'photo.png')] }; }
beforeEach(() => { vi.clearAllMocks(); mocks.importDrop.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('editor-wide native file drops', () => {
  it('imports exactly once outside Media even when a child has its own drop action', async () => {
    const childDrop = vi.fn();
    render(<><EditorFileDrop /><div data-testid="preview" onDrop={childDrop}>Preview</div></>);
    const dataTransfer = transfer();
    fireEvent.dragEnter(screen.getByTestId('preview'), { dataTransfer });
    expect(screen.getByRole('status').textContent).toContain('Media');
    fireEvent.drop(screen.getByTestId('preview'), { dataTransfer });
    expect(mocks.importDrop).toHaveBeenCalledTimes(1);
    expect(mocks.importDrop).toHaveBeenCalledWith(dataTransfer, null, expect.objectContaining({ importFiles: mocks.importFiles }));
    expect(childDrop).not.toHaveBeenCalled();
    expect(mocks.activate).toHaveBeenCalledWith('media');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['timeline', 'media'])('leaves %s placement to the existing handler without double importing', target => {
    const drop = vi.fn();
    render(<><EditorFileDrop /><div data-testid="target" data-panel-type={target} className={target === 'media' ? 'media-panel' : ''} onDrop={drop}>Target</div></>);
    const dataTransfer = transfer();
    fireEvent.dragOver(screen.getByTestId('target'), { dataTransfer });
    expect(screen.getByRole('status').textContent).toContain(target === 'timeline' ? 'Timeline' : 'Media');
    fireEvent.drop(screen.getByTestId('target'), { dataTransfer });
    expect(drop).toHaveBeenCalledOnce();
    expect(mocks.importDrop).not.toHaveBeenCalled();
  });

  it('ignores internal media drags even if native export also supplies files', () => {
    render(<EditorFileDrop />);
    const dataTransfer = transfer(['Files', 'application/x-media-file-id']);
    fireEvent.dragOver(document.body, { dataTransfer });
    fireEvent.drop(document.body, { dataTransfer });
    expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.importDrop).not.toHaveBeenCalled();
  });

  it('clears on escape, window exit and native drag end, but not between child elements', () => {
    render(<EditorFileDrop />);
    const dataTransfer = transfer();
    fireEvent.dragEnter(document.body, { dataTransfer });
    fireEvent(document.body, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.documentElement, clientX: 10, clientY: 10 }));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.dragEnter(document.body, { dataTransfer });
    fireEvent(document.body, new MouseEvent('dragleave', { bubbles: true, relatedTarget: null, clientX: 0, clientY: 0 }));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.dragEnter(document.body, { dataTransfer });
    fireEvent.dragEnd(document.body);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports an import failure and still dismisses the overlay', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.importDrop.mockRejectedValue(new Error('File unavailable'));
    render(<EditorFileDrop />);
    fireEvent.drop(document.body, { dataTransfer: transfer() });
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Could not import files: File unavailable'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

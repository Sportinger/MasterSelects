import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectNameDialog } from '../../src/components/common/ProjectNameDialog';
import { validateProjectName } from '../../src/components/common/projectNameValidation';

describe('ProjectNameDialog', () => {
  it('focuses and selects the default name while explaining that spaces are allowed', () => {
    render(
      <ProjectNameDialog
        mode="new"
        initialName="New Project"
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('New Project'.length);
    expect(screen.getByText(/Spaces are allowed/i)).toBeInTheDocument();
  });

  it('trims outer whitespace while preserving spaces inside the submitted name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const onClose = vi.fn();
    render(
      <ProjectNameDialog
        mode="new"
        initialName="New Project"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: '  My New Project  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Choose Location/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('My New Project'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports invalid filesystem characters without submitting', () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(
      <ProjectNameDialog
        mode="new"
        initialName="New Project"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Project: One' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Choose Location/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('cannot contain');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the returned creation error', async () => {
    const onClose = vi.fn();
    render(
      <ProjectNameDialog
        mode="new"
        initialName="My Project"
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue('The selected folder could not be created.')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Choose Location/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be created');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('My Project');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the unsaved-work warning and closes with Escape when idle', () => {
    const onClose = vi.fn();
    render(
      <ProjectNameDialog
        mode="new"
        initialName="New Project"
        hasUnsavedChanges
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the stable invoking control when the dialog unmounts', () => {
    const returnTarget = document.createElement('button');
    document.body.append(returnTarget);
    returnTarget.focus();
    const { unmount } = render(
      <ProjectNameDialog
        mode="new"
        initialName="New Project"
        restoreFocusTo={returnTarget}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveFocus();
    unmount();
    expect(returnTarget).toHaveFocus();
    returnTarget.remove();
  });

  it('blocks duplicate submission and Escape while project creation is running', async () => {
    let finishSubmission: ((value: string | null) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<string | null>((resolve) => {
      finishSubmission = resolve;
    }));
    const onClose = vi.fn();
    render(
      <ProjectNameDialog
        mode="new"
        initialName="My Project"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Choose Location/i }));
    expect(screen.getByRole('button', { name: /Working/i })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    finishSubmission?.(null);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('rejects blank, trailing-period, and operating-system-reserved names', () => {
    expect(validateProjectName('   ')).toBe('Enter a project name.');
    expect(validateProjectName('Project.')).toContain('period');
    expect(validateProjectName('CON')).toContain('reserved');
    expect(validateProjectName('Project With Spaces')).toBeNull();
  });
});

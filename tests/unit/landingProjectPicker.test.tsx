import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from '../../src/marketing/LandingPage';
import { useAccountStore } from '../../src/stores/accountStore';
import type { RecentProjectEntry } from '../../src/services/projectFileService';

const recentProjects: RecentProjectEntry[] = Array.from({ length: 5 }, (_, index) => ({
  backend: 'native',
  id: `recent-${index + 1}`,
  lastOpenedAt: Date.UTC(2026, 6, index + 1),
  name: `Project ${index + 1}`,
  path: `C:/Projects/Project ${index + 1}`,
}));

afterEach(() => {
  cleanup();
  act(() => {
    useAccountStore.setState({ session: null, user: null });
  });
  vi.useRealTimers();
});

describe('Start layout project picker', () => {
  it('shows New project and every recent project before enabling chat', () => {
    render(
      <LandingPage
        onChooseNewProject={() => undefined}
        onOpenRecentProject={() => undefined}
        recentProjects={recentProjects}
        selectedProjectId={null}
      />,
    );

    expect(screen.getByRole('button', { name: /New project/i })).toBeInTheDocument();
    for (const project of recentProjects) {
      expect(screen.getByRole('button', { name: new RegExp(project.name) })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Message for AI Chat')).toBeDisabled();
    expect(screen.getByLabelText('Choose a project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next projects' })).toBeInTheDocument();
  });

  it('activates a blank project only after New project is chosen', () => {
    const onChooseNewProject = vi.fn();
    render(
      <LandingPage
        onChooseNewProject={onChooseNewProject}
        recentProjects={recentProjects}
        selectedProjectId={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /New project/i }));
    expect(onChooseNewProject).toHaveBeenCalledOnce();
  });

  it('offers an Open project fallback for choosing another project folder', () => {
    const onOpenProject = vi.fn();
    render(
      <LandingPage
        onChooseNewProject={() => undefined}
        onOpenProject={onOpenProject}
        recentProjects={recentProjects}
        selectedProjectId={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open project/i }));
    expect(onOpenProject).toHaveBeenCalledOnce();
  });

  it('collects the new project title in the glowing chat pill', async () => {
    const onCancelNewProjectNaming = vi.fn();
    const onCreateNewProject = vi.fn(async () => null);
    render(
      <LandingPage
        isNewProjectNaming
        onCancelNewProjectNaming={onCancelNewProjectNaming}
        onChooseNewProject={() => undefined}
        onCreateNewProject={onCreateNewProject}
        recentProjects={recentProjects}
        selectedProjectId={null}
      />,
    );

    expect(screen.getByLabelText('Name new project')).toHaveClass('is-project-naming');
    expect(screen.getByLabelText('Choose a project')).toHaveClass('is-exiting');
    const titleInput = screen.getByLabelText('Project title');
    expect(titleInput).toBeEnabled();
    fireEvent.change(titleInput, { target: { value: 'Quiet documentary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to project location' }));

    await waitFor(() => expect(onCreateNewProject).toHaveBeenCalledWith('Quiet documentary'));
  });

  it('returns from project naming to the project picker with Escape', () => {
    const onCancelNewProjectNaming = vi.fn();
    render(
      <LandingPage
        isNewProjectNaming
        onCancelNewProjectNaming={onCancelNewProjectNaming}
        onChooseNewProject={() => undefined}
        recentProjects={recentProjects}
        selectedProjectId={null}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Project title'), { key: 'Escape' });
    expect(onCancelNewProjectNaming).toHaveBeenCalledOnce();
  });

  it('animates the project picker upward after a project is selected', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <LandingPage
        onChooseNewProject={() => undefined}
        recentProjects={recentProjects}
        selectedProjectId={null}
      />,
    );

    rerender(
      <LandingPage
        onChooseNewProject={() => undefined}
        recentProjects={recentProjects}
        selectedProjectId="new"
      />,
    );
    expect(screen.getByLabelText('Choose a project')).toHaveClass('is-exiting');

    act(() => vi.advanceTimersByTime(460));
    expect(screen.queryByLabelText('Choose a project')).not.toBeInTheDocument();
  });

  it('shows Login or the authenticated display name in the top-right account action', () => {
    const { rerender } = render(<LandingPage />);
    expect(screen.getByRole('button', { name: 'Login' })).toHaveTextContent('Login');

    act(() => {
      useAccountStore.setState({
        session: { authenticated: true, provider: 'dev' },
        user: {
          avatarUrl: null,
          displayName: 'Roman Test',
          email: 'roman@example.com',
          id: 'user-1',
          lastAiModel: null,
          lastAppVersion: null,
          lastLoginAt: null,
        },
      });
    });
    rerender(<LandingPage />);

    expect(screen.getByRole('button', { name: 'Open account for Roman Test' }))
      .toHaveTextContent('Roman Test');
  });
});

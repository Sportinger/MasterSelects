// The load screen of a project switch that waits for media copies offers "Continue without it" once the
// wait took a while (projectSwitchCopyWait). Desktop shows it in the load toast, whose pointer-events are
// off except for this button; the phone shows it on its opaque loading view. Pointer activation must not
// leave a focus ring behind.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectLoadProgress } from '../../src/stores/mediaStore/types';

const state = vi.hoisted(() => ({ progress: null as unknown as ProjectLoadProgress }));
vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: (select: (value: { projectLoadProgress: ProjectLoadProgress }) => unknown) => select({ projectLoadProgress: state.progress }),
}));
vi.mock('../../src/components/common/LiveInputReconnectPrompt', () => ({ LiveInputReconnectPrompt: () => null }));
vi.mock('../../src/components/common/PremiereSequenceImportDialog', () => ({ PremiereSequenceImportDialog: () => null }));
const wait = vi.hoisted(() => ({ continueProjectSwitchWithoutCopies: vi.fn() }));
vi.mock('../../src/services/project/mediaCopy/projectSwitchCopyWait', () => wait);

import { ProjectLoadProgressOverlay } from '../../src/components/common/ProjectLoadProgressOverlay';
import { PhoneProjectLoadingView } from '../../src/components/mobileSkin/runtime/PhoneProjectLoadingView';

const waiting = (action?: ProjectLoadProgress['action']): ProjectLoadProgress => ({
  active: true, phase: 'opening', percent: 40, message: 'Finishing the copy into the current project',
  detail: '1 file · 2.0 GB left', blocking: true, action,
});

afterEach(() => { cleanup(); wait.continueProjectSwitchWithoutCopies.mockReset(); });

describe.each([
  ['desktop load toast', () => <ProjectLoadProgressOverlay />],
  ['phone loading view', () => <PhoneProjectLoadingView booting={false} />],
])('%s', (_name, view) => {
  it('shows no way out before the switch has waited a while', () => {
    state.progress = waiting();
    render(view());
    expect(screen.queryByTestId('project-switch-continue-without-copies')).toBeNull();
  });

  it('offers "Continue without it" with its consequence, continues on click and drops pointer focus', () => {
    state.progress = waiting('continue-without-copies');
    render(view());
    expect(screen.getByText('Media not copied yet must be picked again in this project.')).toBeTruthy();
    const button = screen.getByTestId('project-switch-continue-without-copies');
    expect(button.textContent).toBe('Continue without it');
    act(() => { button.focus(); });
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(wait.continueProjectSwitchWithoutCopies).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(button);
  });
});

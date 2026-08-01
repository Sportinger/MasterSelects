export type TutorialNavigationDirection = 'next' | 'previous';

interface TutorialNavigationController {
  next: () => void;
  previous: () => void;
}

let activeController: TutorialNavigationController | null = null;

export function registerTutorialNavigationController(
  controller: TutorialNavigationController,
): () => void {
  activeController = controller;
  return () => {
    if (activeController === controller) {
      activeController = null;
    }
  };
}

export function requestTutorialNavigation(direction: TutorialNavigationDirection): boolean {
  if (!activeController) return false;
  activeController[direction]();
  return true;
}

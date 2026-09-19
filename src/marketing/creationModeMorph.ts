import type { CreationModeTarget } from './CreationModeLandingPage';

interface CreationModeMorphRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface CreationModeMorphTargetRect extends CreationModeMorphRect {
  borderRadius: string;
}

interface CreationModeMorphItem {
  clone: HTMLElement;
  id: string;
  origin: CreationModeMorphRect;
}

export interface CreationModeMorphSnapshot {
  items: CreationModeMorphItem[];
}

export interface CreationModeTargetSnapshot {
  rects: Map<string, CreationModeMorphTargetRect>;
  target: CreationModeTarget;
}

const CREATION_MODE_MORPH_IDS: Record<CreationModeTarget, string[]> = {
  chat: ['surface:start', 'start:chat-pill'],
  editor: ['panel:media', 'panel:preview', 'panel:export', 'panel:timeline'],
  medium: [],
};

function toRect(rect: DOMRect): CreationModeMorphRect {
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

export function captureCreationModeMorphSnapshot(
  root: HTMLElement,
  target: CreationModeTarget,
): CreationModeMorphSnapshot {
  const items: CreationModeMorphItem[] = [];
  const wasAlreadyMeasuring = root.classList.contains('is-measuring-creation-mode-destinations');
  root.classList.add('is-measuring-creation-mode-destinations');

  try {
    const sources = root.querySelectorAll<HTMLElement>(
      `[data-creation-mode-target="${target}"][data-creation-morph-id]`,
    );

    sources.forEach((source) => {
      const id = source.dataset.creationMorphId;
      const rect = source.getBoundingClientRect();
      if (!id || rect.width <= 0 || rect.height <= 0) return;

      const clone = source.cloneNode(true) as HTMLElement;
      clone.classList.add('creation-mode-morph-clone');
      clone.removeAttribute('data-creation-mode-target');
      clone.removeAttribute('data-creation-morph-id');
      items.push({ clone, id, origin: toRect(rect) });
    });
  } finally {
    if (!wasAlreadyMeasuring) {
      root.classList.remove('is-measuring-creation-mode-destinations');
    }
  }

  return { items };
}

function findMorphTarget(id: string): HTMLElement | null {
  const explicitTarget = document.querySelector<HTMLElement>(
    `[data-creation-morph-target="${id}"]`,
  );
  if (explicitTarget) return explicitTarget;

  const candidates = document.querySelectorAll<HTMLElement>('[data-dock-layout-anim-id]');
  for (const candidate of candidates) {
    if (
      candidate.dataset.dockLayoutAnimId === id
      && (
        candidate.classList.contains('dock-tab-pane')
        || candidate.classList.contains('floating-panel')
      )
    ) {
      return candidate;
    }
  }
  return null;
}

export function captureCreationModeTargetSnapshot(
  target: CreationModeTarget,
): CreationModeTargetSnapshot {
  const rects = new Map<string, CreationModeMorphTargetRect>();

  CREATION_MODE_MORPH_IDS[target].forEach((id) => {
    const element = findMorphTarget(id);
    if (!element) return;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    rects.set(id, {
      ...toRect(rect),
      borderRadius: window.getComputedStyle(element).borderRadius,
    });
  });

  return { rects, target };
}

function createMorphOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'creation-mode-morph-overlay';
  document.body.appendChild(overlay);
  return overlay;
}

export async function runCreationModeMorph(
  snapshot: CreationModeMorphSnapshot,
  durationMs: number,
): Promise<void> {
  if (
    snapshot.items.length === 0
    || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  ) {
    return;
  }

  const overlay = createMorphOverlay();

  const animations: Animation[] = [];

  snapshot.items.forEach((item, index) => {
    const target = findMorphTarget(item.id);
    if (!target) return;

    const destination = target.getBoundingClientRect();
    if (destination.width <= 0 || destination.height <= 0) return;

    const { clone, origin } = item;
    clone.style.left = `${origin.left}px`;
    clone.style.top = `${origin.top}px`;
    clone.style.width = `${origin.width}px`;
    clone.style.height = `${origin.height}px`;
    overlay.appendChild(clone);

    if (typeof clone.animate !== 'function') return;

    const translateX = destination.left - origin.left;
    const translateY = destination.top - origin.top;
    const scaleX = destination.width / Math.max(origin.width, 1);
    const scaleY = destination.height / Math.max(origin.height, 1);
    const delayMs = Math.min(90, index * 28);
    const itemDurationMs = Math.max(420, durationMs - delayMs);
    const destinationTransform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;
    const destinationBorderRadius = window.getComputedStyle(target).borderRadius;

    const animation = clone.animate(
      [
        {
          borderRadius: window.getComputedStyle(clone).borderRadius,
          opacity: 1,
          transform: 'translate3d(0, 0, 0) scale(1, 1)',
          offset: 0,
        },
        {
          borderRadius: destinationBorderRadius,
          opacity: 1,
          transform: destinationTransform,
          offset: 0.82,
        },
        {
          borderRadius: destinationBorderRadius,
          opacity: 0,
          transform: destinationTransform,
          offset: 1,
        },
      ],
      {
        delay: delayMs,
        duration: itemDurationMs,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      },
    );
    animations.push(animation);
  });

  if (animations.length === 0) {
    overlay.remove();
    return;
  }

  await Promise.allSettled(animations.map((animation) => animation.finished));
  overlay.remove();
}

export async function runCreationModeReverseMorph(
  destinationSnapshot: CreationModeMorphSnapshot,
  sourceSnapshot: CreationModeTargetSnapshot,
  durationMs: number,
): Promise<void> {
  if (
    destinationSnapshot.items.length === 0
    || sourceSnapshot.rects.size === 0
    || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  ) {
    return;
  }

  const overlay = createMorphOverlay();
  const animations: Animation[] = [];

  destinationSnapshot.items.forEach((item, index) => {
    const source = sourceSnapshot.rects.get(item.id);
    if (!source) return;

    const { clone, origin: destination } = item;
    clone.style.left = `${destination.left}px`;
    clone.style.top = `${destination.top}px`;
    clone.style.width = `${destination.width}px`;
    clone.style.height = `${destination.height}px`;
    overlay.appendChild(clone);

    if (typeof clone.animate !== 'function') return;

    const sourceTransform = `translate3d(${source.left - destination.left}px, ${source.top - destination.top}px, 0) scale(${source.width / Math.max(destination.width, 1)}, ${source.height / Math.max(destination.height, 1)})`;
    const delayMs = Math.min(90, index * 28);
    const itemDurationMs = Math.max(420, durationMs - delayMs);
    const destinationBorderRadius = window.getComputedStyle(clone).borderRadius;

    const animation = clone.animate(
      [
        {
          borderRadius: source.borderRadius,
          opacity: 1,
          transform: sourceTransform,
          offset: 0,
        },
        {
          borderRadius: destinationBorderRadius,
          opacity: 1,
          transform: 'translate3d(0, 0, 0) scale(1, 1)',
          offset: 0.84,
        },
        {
          borderRadius: destinationBorderRadius,
          opacity: 0,
          transform: 'translate3d(0, 0, 0) scale(1, 1)',
          offset: 1,
        },
      ],
      {
        delay: delayMs,
        duration: itemDurationMs,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      },
    );
    animations.push(animation);
  });

  if (animations.length === 0) {
    overlay.remove();
    return;
  }

  await Promise.allSettled(animations.map((animation) => animation.finished));
  overlay.remove();
}

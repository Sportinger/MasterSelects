interface LayoutOverflowEntry {
  path: string;
  tag: string;
  className: string;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  overflowPx: number;
  horizontalScrollbarPx: number;
  verticalScrollbarPx: number;
  overflowX: string;
  overflowY: string;
  rect: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
  parentPath: string | null;
  extendsParentLeftPx: number;
  extendsParentRightPx: number;
  hasVisibleHorizontalScrollbar: boolean;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function describeElement(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && segments.length < 5) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += `#${current.id}`;
      segments.unshift(segment);
      break;
    }
    const classes = Array.from(current.classList).slice(0, 4);
    if (classes.length > 0) segment += `.${classes.join('.')}`;
    segments.unshift(segment);
    current = current.parentElement;
  }

  return segments.join(' > ');
}

export function inspectLayoutOverflow(args: Record<string, unknown> = {}) {
  const minimumOverflowPx = typeof args.minimumOverflowPx === 'number'
    ? Math.max(0, args.minimumOverflowPx)
    : 1;
  const maxEntries = typeof args.maxEntries === 'number'
    ? Math.max(1, Math.min(250, Math.round(args.maxEntries)))
    : 100;
  const requestedRoot = typeof args.rootSelector === 'string' && args.rootSelector.trim()
    ? args.rootSelector.trim()
    : 'body';
  const root = document.querySelector<HTMLElement>(requestedRoot);

  if (!root) {
    return {
      success: false,
      error: `Layout overflow root was not found: ${requestedRoot}`,
    };
  }

  const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  const entries: LayoutOverflowEntry[] = [];

  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const overflowPx = element.scrollWidth - element.clientWidth;
    const parent = element.parentElement;
    const parentRect = parent?.getBoundingClientRect() ?? null;
    const extendsParentLeftPx = parentRect ? Math.max(0, parentRect.left - rect.left) : 0;
    const extendsParentRightPx = parentRect ? Math.max(0, rect.right - parentRect.right) : 0;
    const horizontalScrollbarPx = Math.max(
      0,
      element.offsetHeight
        - element.clientHeight
        - (Number.parseFloat(style.borderTopWidth) || 0)
        - (Number.parseFloat(style.borderBottomWidth) || 0),
    );
    const verticalScrollbarPx = Math.max(
      0,
      element.offsetWidth
        - element.clientWidth
        - (Number.parseFloat(style.borderLeftWidth) || 0)
        - (Number.parseFloat(style.borderRightWidth) || 0),
    );
    if (
      overflowPx < minimumOverflowPx
      && extendsParentLeftPx < minimumOverflowPx
      && extendsParentRightPx < minimumOverflowPx
    ) {
      continue;
    }

    entries.push({
      path: describeElement(element),
      tag: element.tagName.toLowerCase(),
      className: element.className,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      overflowPx,
      horizontalScrollbarPx: round(horizontalScrollbarPx),
      verticalScrollbarPx: round(verticalScrollbarPx),
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      rect: {
        left: round(rect.left),
        right: round(rect.right),
        top: round(rect.top),
        bottom: round(rect.bottom),
        width: round(rect.width),
        height: round(rect.height),
      },
      parentPath: parent ? describeElement(parent) : null,
      extendsParentLeftPx: round(extendsParentLeftPx),
      extendsParentRightPx: round(extendsParentRightPx),
      hasVisibleHorizontalScrollbar:
        overflowPx >= minimumOverflowPx
        && horizontalScrollbarPx > 0
        && (style.overflowX === 'auto' || style.overflowX === 'scroll'),
    });
  }

  entries.sort((left, right) => {
    if (left.hasVisibleHorizontalScrollbar !== right.hasVisibleHorizontalScrollbar) {
      return left.hasVisibleHorizontalScrollbar ? -1 : 1;
    }
    return Math.max(right.overflowPx, right.extendsParentRightPx, right.extendsParentLeftPx)
      - Math.max(left.overflowPx, left.extendsParentRightPx, left.extendsParentLeftPx);
  });

  const scrollingElement = document.scrollingElement;
  return {
    success: true,
    data: {
      action: 'inspect-layout-overflow',
      root: describeElement(root),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      document: scrollingElement ? {
        clientWidth: scrollingElement.clientWidth,
        scrollWidth: scrollingElement.scrollWidth,
        overflowPx: scrollingElement.scrollWidth - scrollingElement.clientWidth,
      } : null,
      visibleScrollbarCount: entries.filter((entry) => entry.hasVisibleHorizontalScrollbar).length,
      totalCandidateCount: entries.length,
      entries: entries.slice(0, maxEntries),
    },
  };
}

/**
 * Position a submenu using fixed positioning so it escapes any
 * overflow:hidden ancestors. Flips left/up when it would overflow the viewport.
 */
export function handleSubmenuHover(e: React.MouseEvent<HTMLDivElement>) {
  const item = e.currentTarget;
  const submenu = item.querySelector('.add-dropdown-submenu, .context-submenu') as HTMLElement | null;
  if (!submenu) return;

  // Use fixed positioning to escape overflow:hidden containers
  submenu.style.position = 'fixed';
  submenu.style.display = 'block';

  const itemRect = item.getBoundingClientRect();
  const submenuWidth = submenu.offsetWidth;
  const submenuHeight = submenu.offsetHeight;

  // Horizontal: prefer right, flip left if it overflows
  let left: number;
  if (itemRect.right + submenuWidth > window.innerWidth) {
    left = itemRect.left - submenuWidth;
  } else {
    left = itemRect.right;
  }

  // Vertical: align top with item, shift up if it overflows bottom
  let top = itemRect.top;
  if (top + submenuHeight > window.innerHeight) {
    top = window.innerHeight - submenuHeight - 4;
  }
  if (top < 0) top = 4;

  submenu.style.left = `${left}px`;
  submenu.style.top = `${top}px`;
  // Reset any relative offsets from the CSS defaults
  submenu.style.right = 'auto';
}

/** Reset fixed positioning when the mouse leaves so CSS can hide it normally. */
export function handleSubmenuLeave(e: React.MouseEvent<HTMLDivElement>) {
  const item = e.currentTarget;
  const submenu = item.querySelector('.add-dropdown-submenu, .context-submenu') as HTMLElement | null;
  if (!submenu) return;
  submenu.style.position = '';
  submenu.style.left = '';
  submenu.style.top = '';
  submenu.style.right = '';
  submenu.style.display = '';
}

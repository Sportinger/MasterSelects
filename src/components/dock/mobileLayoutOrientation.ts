import {
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
} from '../../stores/dockStore';

interface ResolveMobileLayoutOrientationParams {
  activeLayoutId: string | null;
  compositionWidth: number | undefined;
  compositionHeight: number | undefined;
  enterMobileLayout?: boolean;
}

export function isMobileLayoutId(layoutId: string | null): boolean {
  return layoutId === FACTORY_MOBILE_LAYOUT_ID
    || layoutId === FACTORY_VERTICAL_MOBILE_LAYOUT_ID;
}

export function resolveMobileLayoutForComposition({
  activeLayoutId,
  compositionWidth,
  compositionHeight,
  enterMobileLayout = false,
}: ResolveMobileLayoutOrientationParams): string | null {
  if (
    (!enterMobileLayout && !isMobileLayoutId(activeLayoutId))
    || !compositionWidth
    || !compositionHeight
  ) {
    return null;
  }

  return compositionHeight > compositionWidth
    ? FACTORY_VERTICAL_MOBILE_LAYOUT_ID
    : FACTORY_MOBILE_LAYOUT_ID;
}

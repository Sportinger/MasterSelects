import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  useDockStore,
} from '../../../stores/dockStore';
import { isMobileLayoutId } from '../../dock/mobileLayoutOrientation';

export function useTimelineOverLayout() {
  const activeDockLayoutId = useDockStore((state) => state.activeSavedLayoutId);
  const mediumLayoutOverride = useDockStore((state) => state.mediumLayoutOverride);
  const isMobileTimelineLayout = isMobileLayoutId(activeDockLayoutId);
  const isMediumTimelineLayout = mediumLayoutOverride
    ?? (activeDockLayoutId === FACTORY_MEDIUM_EDIT_LAYOUT_ID);

  return {
    isMediumMobileTimelineLayout: isMobileTimelineLayout && isMediumTimelineLayout,
    isMediumTimelineLayout,
    isMobileTimelineLayout,
  };
}

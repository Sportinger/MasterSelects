import type { ComponentProps } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { TimelineClassicToolbar } from './TimelineClassicToolbar';
import { TimelineSidebar } from './TimelineSidebar';

export function TimelineToolbarChrome(props: ComponentProps<typeof TimelineClassicToolbar>) {
  const compact = useSettingsStore(state => state.compactTimelineToolbar);
  return compact ? <TimelineSidebar {...props} /> : <TimelineClassicToolbar {...props} />;
}

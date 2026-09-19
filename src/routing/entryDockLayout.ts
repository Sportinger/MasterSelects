import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from '../stores/dockStore';
import type { EntryExperience } from './entryExperience';

export type EditorEntryExperience = Extract<
  EntryExperience,
  'chat' | 'editor' | 'medium'
>;

export function resolveInitialDockLayoutId(
  experience: EditorEntryExperience,
): string | null {
  if (experience === 'chat') return FACTORY_START_LAYOUT_ID;
  if (experience === 'medium') return FACTORY_MEDIUM_EDIT_LAYOUT_ID;
  return FACTORY_VIDEO_EDIT_LAYOUT_ID;
}

// The "All tools" list: everything the phone can reach, in one searchable catalog. Built from the
// same sources the rest of the phone uses (the toolbar action catalog, the sheet ids, the desktop
// panel catalog), so a new action or panel shows up here without a second list to maintain.
// Owner rule: nothing is left out; what does not work on the phone yet stays listed, greyed, with
// its reason.

import {
  isMilestoneShipped,
  PHONE_SHIPPED_MILESTONE,
  type PhoneActionAvailability,
  type PhoneActionContext,
  type PhoneIconName,
  type PhoneMilestone,
  type PhoneSheetId,
} from '../contracts';
import { PHONE_ACTIONS, resolvePhoneActionState } from '../actions/phoneActionCatalog';
import { PHONE_ASSISTANT_TASKS } from '../assistant/phoneAssistantTasks';
import { PHONE_PANELS, type PhonePanelEntry } from './phonePanelCatalog';

export type PhoneAllToolsKind = 'action' | 'sheet' | 'panel' | 'view' | 'assistant';

export interface PhoneAllToolsEntry {
  /** Unique: 'action:split', 'sheet:compositions', 'panel:media', 'view:fullscreen', 'assistant:INV-8/assistant-masks'. */
  id: string;
  kind: PhoneAllToolsKind;
  label: string;
  group: string;
  /** Short line under the label; empty when the group header already says it. */
  detail: string;
  /** Toolbar glyph of the row, when it has one. */
  icon?: PhoneIconName;
  milestone: PhoneMilestone;
  state: PhoneActionAvailability;
  /** Extra words the search matches (lower case). */
  keywords: string;
  /** Assistant entries: the request typed into the assistant's field (not sent). */
  prompt?: string;
}

/** Selector of the short word on a greyed row (phonePanelsTestIds.ts belongs to another packet). */
export const PHONE_ALL_TOOLS_BADGE_TEST_ID = 'phone-alltools-badge';

/** Short word on a greyed row; the full reason shows on tap. */
export function phoneAllToolsBadge(state: PhoneActionAvailability): string | null {
  if (state.kind === 'available') return null;
  if (state.reason === SELECT_CLIP_REASON) return 'Select a clip';
  if (state.reason === OPEN_PROJECT_REASON) return 'No project';
  return 'Not now';
}

const SELECT_CLIP_REASON = 'Select a clip on the timeline first: this tool works on the selected clip.';
const OPEN_PROJECT_REASON = 'Open or create a project first: the assistant works on the open project.';

export const PHONE_ALL_TOOLS_GROUP_ORDER = [
  'Main tools', 'Clip tools', 'Sheets', 'View', 'Assistant',
  'Panels: Edit', 'Panels: Media & project', 'Panels: Colour', 'Panels: Audio', 'Panels: AI & analysis', 'Panels: Live & output',
] as const;

/** Sheets reached directly (the M3 pro sheets plus project and export). */
export const PHONE_ALL_TOOLS_SHEETS: ReadonlyArray<{ id: PhoneSheetId; label: string; detail: string; keywords: string }> = [
  { id: 'compositions', label: 'Compositions', detail: 'Create, switch, nest and duplicate', keywords: 'comp nested precompose sequence' },
  { id: 'tracks', label: 'Tracks', detail: 'Add, rename, order, lock and mute', keywords: 'layer lane' },
  { id: 'markers', label: 'Markers', detail: 'Add, name and jump to markers', keywords: 'marker cue' },
  { id: 'captions', label: 'Captions', detail: 'Transcribe, edit and style captions', keywords: 'subtitles transcript words' },
  { id: 'audioFx', label: 'Audio effects', detail: 'EQ, compressor, reverb and more', keywords: 'eq sound filter compressor reverb' },
  { id: 'library', label: 'Library', detail: 'Media, folders and reusable assets', keywords: 'media assets folders bin' },
  { id: 'settings', label: 'Settings', detail: 'Preferences, theme and cache', keywords: 'preferences options theme' },
  { id: 'edits', label: 'Trim modes', detail: 'Ripple, roll, slip and slide', keywords: 'ripple roll slip slide trim' },
  { id: 'replace', label: 'Replace', detail: 'Swap the media of a clip', keywords: 'swap relink' },
  { id: 'projects', label: 'Projects', detail: 'Open, rename and save projects', keywords: 'project open save' },
  { id: 'export', label: 'Export', detail: 'Render and share a video', keywords: 'render share save video' },
  { id: 'clipboard', label: 'Copy & paste', detail: 'Effects, colour and animation between clips', keywords: 'copy paste attributes effects colour grade keyframes' },
  { id: 'textMulti', label: 'Style titles', detail: 'Style several titles at once', keywords: 'text titles multiple select font size colour' },
  { id: 'source', label: 'Source monitor', detail: 'View a file, mark In/Out, insert or overwrite', keywords: 'source monitor in out marks insert overwrite fit fill append place' },
  { id: 'mediaJobs', label: 'Media jobs', detail: 'Proxies, waveforms, imports and analysis', keywords: 'jobs queue proxy transcode waveform progress analysis' },
  { id: 'timelineTools', label: 'Timeline settings', detail: 'Snapping, beat grid, in/out range, tempo, metronome, view', keywords: 'snap magnet grid beats in out range loop tempo bpm meter metronome click focus thumbnails waveforms' },
  { id: 'clipDetails', label: 'Clip details', detail: 'Name, source colour, parent clip, null object', keywords: 'rename label colour color parent parenting null hierarchy track parent' },
  { id: 'bake', label: 'Bake', detail: 'Pre-render a range or clip for smooth playback', keywords: 'bake render cache performance region' },
  { id: 'variants', label: 'Compare alternatives', detail: 'Play versions A/B/C of a range and accept one', keywords: 'storyboard variants alternatives compare a b c range' },
  { id: 'preview-view', label: 'Preview view', detail: 'Clip handles, rulers, guides, 1:1 and before/after compare', keywords: 'gizmo handles move scale rotate snap rulers guides actual pixels 100 zoom split compare before after wipe' },
  { id: 'shape-path', label: 'Shape path', detail: 'Draw a free path by finger, edit points, reveal and dash it', keywords: 'path pen draw line shape bezier points trim reveal dash dashed stroke motion' },
  { id: 'audioRegion', label: 'Sound range', detail: 'Select part of a sound: cut, copy, gain, fades, reverse, channels, effects, repair, room tone', keywords: 'audio region waveform range selection split cut copy paste silence gain fade reverse polarity swap mono effect repair hum click room tone' },
  { id: 'score', label: 'Notation', detail: 'Write notes on a staff and play them', keywords: 'score sheet music notes staff notation musicxml play' },
];

/** Glyphs of the sheet rows that have a matching toolbar icon. */
const SHEET_ICONS: Partial<Record<PhoneSheetId, PhoneIconName>> = {
  compositions: 'compositions', tracks: 'reorder', captions: 'captions', audioFx: 'audio', library: 'media', edits: 'trim',
  replace: 'replace', export: 'export', clipboard: 'duplicate', textMulti: 'text', source: 'media', 'shape-path': 'animation',
  audioRegion: 'volume', score: 'audio', 'preview-view': 'fullscreen', bake: 'effects', variants: 'compositions',
};

/** Sheets that need a selected clip to do anything. */
const CLIP_SHEETS = new Set<PhoneSheetId>(['edits', 'replace']);

function panelState(panel: PhonePanelEntry, shipped: PhoneMilestone): PhoneActionAvailability {
  if (panel.phoneLimit) return { kind: 'unavailable', reason: panel.phoneLimit };
  if (!isMilestoneShipped(panel.milestone, shipped)) {
    return { kind: 'unavailable', reason: `${panel.title} arrives with milestone ${panel.milestone} of the phone editor.` };
  }
  return { kind: 'available' };
}

export function buildPhoneAllToolsEntries(context: PhoneActionContext, shipped: PhoneMilestone = PHONE_SHIPPED_MILESTONE): PhoneAllToolsEntry[] {
  const hasSelection = context.selectedClipIds.length > 0;
  const entries: PhoneAllToolsEntry[] = [];

  for (const action of PHONE_ACTIONS) {
    let state = resolvePhoneActionState(action, context, shipped);
    if (state.kind === 'available' && action.scope === 'clip' && !hasSelection) state = { kind: 'unavailable', reason: SELECT_CLIP_REASON };
    entries.push({
      id: `action:${action.id}`,
      kind: 'action',
      label: action.label,
      group: action.scope === 'root' ? 'Main tools' : 'Clip tools',
      // The group header (Main tools / Clip tools) says where it lives; no repeated subtitle.
      detail: '',
      icon: action.icon,
      milestone: action.milestone,
      state,
      keywords: action.id.replace(/-/g, ' '),
    });
  }

  for (const sheet of PHONE_ALL_TOOLS_SHEETS) {
    const state: PhoneActionAvailability = CLIP_SHEETS.has(sheet.id) && !hasSelection
      ? { kind: 'unavailable', reason: SELECT_CLIP_REASON }
      : { kind: 'available' };
    entries.push({
      id: `sheet:${sheet.id}`, kind: 'sheet', label: sheet.label, group: 'Sheets', detail: sheet.detail, icon: SHEET_ICONS[sheet.id],
      milestone: 'M3', state, keywords: sheet.keywords,
    });
  }

  entries.push({
    id: 'view:fullscreen', kind: 'view', label: 'Fullscreen preview', group: 'View',
    detail: 'Watch the edit on the whole screen', milestone: 'M3', icon: 'fullscreen',
    state: context.engineReady ? { kind: 'available' } : { kind: 'unavailable', reason: 'The preview engine is still starting.' },
    keywords: 'play watch landscape full screen',
  });

  // Every assistant-tier catalog item: one row that opens the assistant with the task typed in.
  for (const task of PHONE_ASSISTANT_TASKS) {
    entries.push({
      id: `assistant:${task.catalogId}`, kind: 'assistant', label: `Ask the assistant: ${task.task}`, group: 'Assistant',
      detail: task.prompt, milestone: 'M5', icon: 'assistant',
      state: context.projectOpen ? { kind: 'available' } : { kind: 'unavailable', reason: OPEN_PROJECT_REASON },
      keywords: `ai chat ${task.keywords} ${task.catalogId.split('/')[1].replace(/-/g, ' ')}`, prompt: task.prompt,
    });
  }

  for (const panel of PHONE_PANELS) {
    entries.push({
      id: `panel:${panel.type}`,
      kind: 'panel',
      label: panel.title,
      group: `Panels: ${panel.group}`,
      detail: panel.workspace ? 'Landscape editor' : 'Desktop panel',
      milestone: panel.milestone,
      state: panelState(panel, shipped),
      keywords: panel.type.replace(/-/g, ' '),
    });
  }
  return entries;
}

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Every word of the query must appear in the label, group, detail or keywords. */
export function filterPhoneAllTools(entries: readonly PhoneAllToolsEntry[], query: string): PhoneAllToolsEntry[] {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = normalise(`${entry.label} ${entry.group} ${entry.detail} ${entry.keywords}`);
    return words.every((word) => haystack.includes(word));
  });
}

/** Entries grouped in display order; empty groups are dropped. */
export function groupPhoneAllTools(entries: readonly PhoneAllToolsEntry[]): Array<{ group: string; entries: PhoneAllToolsEntry[] }> {
  const order: readonly string[] = PHONE_ALL_TOOLS_GROUP_ORDER;
  const groups = new Map<string, PhoneAllToolsEntry[]>();
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  return [...groups.entries()]
    .toSorted(([a], [b]) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1))
    .map(([group, list]) => ({ group, entries: list }));
}

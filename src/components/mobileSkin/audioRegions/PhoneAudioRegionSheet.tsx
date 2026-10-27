// 'audioRegion' sheet ("Sound range", clip scope): the waveform of the selected audio clip (or the
// linked sound of a selected video), a range picked by touch (Select and Move are separate modes,
// edge handles, start/end as numbers, All, channel choice), and every region edit the desktop
// waveform offers: split, cut, copy, paste; gain and fades; silence, insert silence, delete,
// reverse, polarity and channel operations; region effects; repairs and room tone fill; the edit
// stack with bypass, remove and listening. All edits land in ONE edit session: Done keeps them as
// one undo step, Cancel removes them. The range itself is view state and never an undo step.

import { useCallback, useState } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { AudioRegionContextMenuCommand } from '../../timeline/utils/audioRegionContextMenu';
import { blurAfterPointer } from '../audio/PhoneAudioControls';
import { openPhonePropertiesPanel } from '../audiofx/phonePropertiesPanel';
import { PhoneAudioRegionWaveform, type PhoneRegionMode } from './PhoneAudioRegionWaveform';
import { PhoneAudioRegionLevel } from './PhoneAudioRegionLevel';
import { PhoneAudioRegionStack } from './PhoneAudioRegionStack';
import { PhoneAudioRegionRange } from './PhoneAudioRegionRange';
import { usePhoneRegionCommands } from './phoneAudioRegionCommands';
import { isPhoneRegionOf, resolvePhoneRegionTarget, type PhoneRegionChannel } from './phoneAudioRegionModel';
import { PHONE_AUDIO_REGION_TEST_IDS as IDS } from './phoneAudioRegionTestIds';
import '../audio/PhoneAudioSheets.css';
import './PhoneAudioRegions.css';

type Section = 'edit' | 'level' | 'time' | 'fx' | 'repair' | 'stack';

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'level', label: 'Level' },
  { id: 'time', label: 'Time & channels' },
  { id: 'fx', label: 'Effects' },
  { id: 'repair', label: 'Repair' },
  { id: 'stack', label: 'Stack' },
];

/** Region menu groups shown in each tab (keys of createAudioRegionContextMenuModel). */
const TAB_GROUPS: Partial<Record<Section, readonly string[]>> = {
  time: ['time', 'polarity', 'channels'],
  fx: ['fx'],
  repair: ['repair'],
};

export const PhoneAudioRegionSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneEditSession('Edit sound range');
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const storeSelection = useTimelineStore((state) => state.audioRegionSelection);
  const hasClipboard = useTimelineStore((state) => state.audioRegionClipboard !== null);
  const [section, setSection] = useState<Section>('edit');
  const [mode, setMode] = useState<PhoneRegionMode>('select');
  const [channel, setChannel] = useState<PhoneRegionChannel>('both');
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [closing, setClosing] = useState(false);

  const target = resolvePhoneRegionTarget(clips, tracks, [...selectedClipIds]);
  const clip = target.kind === 'ready' ? target.clip : null;
  const selection = isPhoneRegionOf(clip, storeSelection) ? storeSelection : null;
  const blockedReason = target.kind === 'none'
    ? target.reason
    : target.locked ? 'The track of this clip is locked. Unlock it in the Tracks sheet to edit its sound.' : null;

  const report = useCallback((text: string | null, tone: 'info' | 'error' = 'info') => {
    setMessage(text ? { text, tone } : null);
  }, []);
  const commands = usePhoneRegionCommands({ session, clipId: clip?.id ?? null, selection, channel, hasClipboard, report });

  const explainBlocked = () => {
    showUnavailable({ actionId: 'audio-region', label: 'Sound range', reason: blockedReason ?? 'Select a range of the sound first: drag across the waveform, or tap All.' });
  };
  const setRange = (next: TimelineAudioRegionSelection | null) => {
    if (next) useTimelineStore.getState().setAudioRegionSelection(next);
    else useTimelineStore.getState().clearAudioRegionSelection();
  };

  const finish = async (keep: boolean) => {
    if (closing) return;
    setClosing(true);
    if (keep && session.changed) {
      const result = await session.commit();
      if (!result.ok) showToast(result.message, 'error');
    } else {
      session.cancel();
    }
    useTimelineStore.getState().clearAudioRegionSelection();
    closeSheet();
  };

  const openStackPanel = async () => {
    if (session.changed) {
      const result = await session.commit();
      if (!result.ok) showToast(result.message, 'error');
    } else session.cancel();
    useTimelineStore.getState().clearAudioRegionSelection();
    openPhonePropertiesPanel({ clipId: clip?.id ?? null, tab: 'audio-edits', title: 'Audio edits' });
  };

  const commandButton = (command: AudioRegionContextMenuCommand) => {
    const off = Boolean(blockedReason) || !selection || command.disabled === true;
    return (
      <button
        key={command.key}
        type="button"
        className="phone-region-cmd"
        data-testid={`${IDS.commandPrefix}${command.key}`}
        data-danger={command.danger || undefined}
        aria-disabled={off || undefined}
        onPointerUp={blurAfterPointer}
        onClick={() => {
          if (blockedReason || !selection) { explainBlocked(); return; }
          if (command.disabled) { showUnavailable({ actionId: 'audio-region-paste', label: command.label, reason: 'Copy or cut a range first; Paste puts it into the selected range.' }); return; }
          command.action();
        }}
      >
        {command.label}
      </button>
    );
  };

  const groupCommands = (keys: readonly string[]) => commands.model.groups
    .filter((group) => keys.includes(group.key))
    .map((group) => (
      <div key={group.key} className="phone-region-group" role="group" aria-label={group.label}>
        <span className="phone-audio-more__heading">{group.label}</span>
        <div className="phone-region-group__items">{group.commands.map(commandButton)}</div>
      </div>
    ));

  const editCommands = [
    ...commands.model.directCommands,
    ...(commands.model.groups.find((group) => group.key === 'clipboard')?.commands.filter((command) => command.key === 'paste-region') ?? []),
  ];
  const silence = commands.model.groups.flatMap((group) => group.commands).find((command) => command.key === 'silence');

  return (
    <PhoneSheet title="Sound range" height="tall" onCancel={() => { void finish(false); }} onDone={() => { void finish(true); }} doneDisabled={closing}>
      <div className="phone-audio-sheet phone-region" data-testid={IDS.root} data-clip-id={clip?.id ?? ''}>
        {blockedReason ? <p className="phone-audio-sheet__blocked" data-testid={IDS.blocked}>{blockedReason}</p> : null}
        {clip ? (
          <>
            <p className="phone-audio-sheet__target">{clip.name}{target.kind === 'ready' && target.viaLinkedVideo ? ' (sound of the selected video)' : ''}</p>
            <PhoneAudioRegionWaveform clip={clip} selection={selection} mode={mode} disabled={Boolean(blockedReason)}
              onDisabledTap={explainBlocked} onChange={setRange} />
            <PhoneAudioRegionRange clip={clip} selection={selection} mode={mode} channel={channel} disabled={Boolean(blockedReason)}
              onDisabledTap={explainBlocked} onMode={setMode} onChannel={setChannel} onRange={setRange} />
          </>
        ) : null}

        <div className="phone-audio-tabs" role="tablist" aria-label="Range tools">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" role="tab" className="phone-audio-tabs__tab" aria-selected={section === item.id}
              data-testid={`${IDS.sectionPrefix}${item.id}`} onPointerUp={blurAfterPointer} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {section === 'edit' ? (
          <div className="phone-audio-section" role="tabpanel" aria-label="Edit">
            <div className="phone-region-group__items">{editCommands.map(commandButton)}</div>
            <p className="phone-audio-sheet__hint">Split cuts the clip at both edges of the range. Cut leaves a gap and keeps the sound on the clipboard; Paste into range replaces the selected range with it.</p>
          </div>
        ) : null}
        {section === 'level' && clip ? (
          <PhoneAudioRegionLevel clip={clip} selection={selection} disabled={Boolean(blockedReason)} onDisabledTap={explainBlocked}
            silence={silence} onGain={commands.setGain} />
        ) : null}
        {TAB_GROUPS[section] ? (
          <div className="phone-audio-section" role="tabpanel" aria-label={section}>
            {groupCommands(TAB_GROUPS[section]!)}
            {section === 'repair' ? (
              <div className="phone-region-group" role="group" aria-label="Room tone">
                <span className="phone-audio-more__heading">Room tone</span>
                <button type="button" className="phone-region-cmd" data-testid={IDS.roomTone} aria-disabled={Boolean(blockedReason) || !selection || undefined}
                  onPointerUp={blurAfterPointer} onClick={() => { if (blockedReason || !selection) explainBlocked(); else void commands.roomTone(); }}>
                  Fill with room tone
                </button>
              </div>
            ) : null}
            {section === 'fx' || section === 'repair' ? (
              <p className="phone-audio-sheet__hint">Applies only to the selected range (edges are feathered). Bypass or remove it under Stack; listen there too.</p>
            ) : null}
          </div>
        ) : null}
        {section === 'stack' && clip ? (
          <PhoneAudioRegionStack clip={clip} selection={selection} disabled={Boolean(blockedReason)} onDisabledTap={explainBlocked}
            onSelect={setRange} onToggle={commands.toggleOperation} onRemove={commands.removeOperation}
            onOpenPanel={() => { void openStackPanel(); }} />
        ) : null}

        {message ? (
          <p className={message.tone === 'error' ? 'phone-audio-sheet__error' : 'phone-audio-sheet__hint'} role={message.tone === 'error' ? 'alert' : 'status'}
            data-testid={IDS.message} data-tone={message.tone}>
            {message.text}
          </p>
        ) : null}
      </div>
    </PhoneSheet>
  );
};

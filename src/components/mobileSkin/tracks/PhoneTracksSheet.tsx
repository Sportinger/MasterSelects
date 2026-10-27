// 'tracks' sheet (root): every track of the open composition, video on top as on the timeline. Add a
// video or audio track; per track hide/mute, solo, lock and target; under "More" rename, colour,
// height, move up/down and delete. Every change applies live through the editor's own track actions
// inside ONE owned edit session: Done keeps everything as one undo step, Cancel rolls it all back.
// Audio and MIDI tracks also get level and pan under "More" (the desktop mixer's values); MIDI tracks
// can be added and hand over to the landscape piano roll ("Edit notes"); "Mixer" opens the landscape
// mixer for sends, track effects and the master bus. Leaving for an editor keeps the sheet's changes
// as one undo step first, so no transaction stays open.

import { useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrack } from '../../../types/timeline';
import type { LabelColor } from '../../../stores/mediaStore/types';
import type { PhoneSheetComponent } from '../contracts';
import { openPhoneEditor } from '../audiofx/phoneOpenEditor';
import { ProButton, ProMessage, ProSection, ProTextField } from '../compositions/phoneProControls';
import { blurAfterPointer } from '../compositions/phoneProFocus';
import { ProGlyph, type ProGlyphName } from '../compositions/phoneProGlyphs';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  PHONE_TRACK_COLORS, PHONE_TRACK_HEIGHTS, nearestPhoneTrackHeight, phoneTrackDeleteReason, planPhoneTrackMove,
} from './phoneTrackCommands';
import { PhoneTrackAudioRows } from './PhoneTrackAudioRows';
import { PHONE_TRACKS_TEST_IDS as IDS } from './phoneTracksTestIds';
import './PhoneTracksSheet.css';

const TRACK_GLYPH: Record<TimelineTrack['type'], ProGlyphName> = {
  video: 'track-video', audio: 'track-audio', midi: 'track-midi', score: 'track-midi',
};


function trackMeta(track: TimelineTrack, clipCount: number): string {
  const type = track.type === 'video' ? 'Video' : track.type === 'audio' ? 'Audio' : track.type === 'midi' ? 'MIDI' : track.type;
  return `${type} · ${clipCount} clip${clipCount === 1 ? '' : 's'}`;
}

export const PhoneTracksSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Tracks');
  const tracks = useTimelineStore((state) => state.tracks);
  const clips = useTimelineStore((state) => state.clips);
  const targets = useTimelineStore((state) => state.targetTrackIdByType);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (apply: (store: ReturnType<typeof useTimelineStore.getState>) => void) => {
    setMessage(null);
    void session.apply(() => apply(useTimelineStore.getState()));
  };

  const addTrack = (type: 'video' | 'audio' | 'midi') => {
    void session.apply(() => {
      const id = useTimelineStore.getState().addTrack(type);
      setExpandedId(null);
      setMessage(`Added ${useTimelineStore.getState().tracks.find((track) => track.id === id)?.name ?? 'a track'}.`);
    });
  };

  const expand = (track: TimelineTrack) => {
    setRenameValue(track.name);
    setExpandedId(expandedId === track.id ? null : track.id);
  };

  const move = (track: TimelineTrack, direction: 'up' | 'down') => {
    const plan = planPhoneTrackMove(useTimelineStore.getState().tracks, track.id, direction);
    if (!plan.ok) { setMessage(plan.reason); return; }
    change((store) => store.reorderTrack(track.id, plan.targetId, plan.placeBelow));
  };

  const rename = (track: TimelineTrack) => {
    const name = renameValue.trim();
    if (!name) { setMessage('Give the track a name.'); return; }
    change((store) => store.renameTrack(track.id, name.slice(0, 120)));
  };

  const remove = (track: TimelineTrack) => {
    const count = clips.filter((clip) => clip.trackId === track.id).length;
    change((store) => store.removeTrack(track.id));
    setExpandedId(null);
    setMessage(`Deleted ${track.name}${count > 0 ? ` and its ${count} clip${count === 1 ? '' : 's'}` : ''}. Cancel brings it back.`);
  };

  /** Keeps this sheet's changes (one undo step), then opens a landscape editor in its place. */
  const leaveTo = async (open: () => void) => {
    if (busy) return;
    setBusy(true);
    if (session.changed) {
      const result = await session.commit();
      if (!result.ok) showToast(result.message, 'error');
    } else {
      session.cancel();
    }
    open();
  };

  const editNotes = (track: TimelineTrack) => {
    // The piano roll edits the selected MIDI clip; without one it offers to create one at the playhead.
    void leaveTo(() => {
      const state = useTimelineStore.getState();
      const onTrack = state.clips.filter((clip) => clip.trackId === track.id).toSorted((a, b) => a.startTime - b.startTime);
      const underPlayhead = onTrack.find((clip) => state.playheadPosition >= clip.startTime && state.playheadPosition < clip.startTime + clip.duration);
      const clip = underPlayhead ?? onTrack[0];
      if (!clip) state.selectClips([], { revealProperties: false });
      openPhoneEditor('pianoRoll', { clipId: clip?.id ?? null });
    });
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  return (
    <PhoneSheet title="Tracks" height="tall" onCancel={cancel} onDone={() => void done()} doneDisabled={busy}>
      <div className="phone-tracks">
        <ProMessage text={message} testId={IDS.message} />
        <ul className="phone-pro-list" data-testid={IDS.list}>
          {tracks.map((track) => {
            const clipCount = clips.filter((clip) => clip.trackId === track.id).length;
            const expanded = expandedId === track.id;
            const hidden = track.visible === false;
            const isVideo = track.type === 'video';
            const targeted = targets[track.type] === track.id;
            const lockedReason = track.locked ? 'Unlock the track first.' : null;
            const color = PHONE_TRACK_COLORS.find((entry) => entry.key === (track.labelColor ?? 'none'));
            return (
              <li
                key={track.id}
                className="phone-pro-row phone-tracks__row"
                data-testid={IDS.row}
                data-track-id={track.id}
                data-track-type={track.type}
                data-hidden={hidden ? 'true' : 'false'}
                data-muted={track.muted ? 'true' : 'false'}
                data-solo={track.solo ? 'true' : 'false'}
                data-locked={track.locked ? 'true' : 'false'}
                style={{ borderLeftColor: color && color.key !== 'none' ? color.hex : undefined }}
              >
                <div className="phone-pro-row__main">
                  <span className="phone-tracks__type" aria-hidden="true"
                    style={{ color: color && color.key !== 'none' ? color.hex : undefined }}>
                    <ProGlyph name={TRACK_GLYPH[track.type]} />
                  </span>
                  <button
                    type="button"
                    className="phone-pro-row__title"
                    aria-expanded={expanded}
                    aria-label={`${track.name}: more settings`}
                    data-testid={IDS.name}
                    onPointerUp={blurAfterPointer}
                    onClick={() => expand(track)}
                  >
                    <span className="phone-pro-row__name">{track.name}</span>
                    <span className="phone-pro-row__meta">{trackMeta(track, clipCount)}</span>
                  </button>
                  <span className="phone-tracks__toggles">
                    {isVideo ? (
                      <ProButton compact label={hidden ? 'Show' : 'Hide'} ariaLabel={`${hidden ? 'Show' : 'Hide'} ${track.name}`} pressed={hidden} testId={IDS.visible}
                        data={{ toggle: 'visible' }} onPress={() => change((store) => store.setTrackVisible(track.id, hidden))}>
                        <ProGlyph name={hidden ? 'eye-off' : 'eye'} />
                      </ProButton>
                    ) : (
                      <ProButton compact label="Mute" ariaLabel={`Mute ${track.name}`} pressed={Boolean(track.muted)} testId={IDS.mute}
                        data={{ toggle: 'mute' }} onPress={() => change((store) => store.setTrackMuted(track.id, !track.muted))}>
                        <ProGlyph name="mute" />
                      </ProButton>
                    )}
                    <ProButton compact label="Solo" ariaLabel={`Solo ${track.name}`} pressed={Boolean(track.solo)} testId={IDS.solo}
                      data={{ toggle: 'solo' }} onPress={() => change((store) => store.setTrackSolo(track.id, !track.solo))}>
                      <ProGlyph name="solo" />
                    </ProButton>
                    <ProButton compact label="Lock" ariaLabel={`Lock ${track.name}`} pressed={Boolean(track.locked)} testId={IDS.lock}
                      data={{ toggle: 'lock' }} onPress={() => change((store) => store.setTrackLocked(track.id, !track.locked))}>
                      <ProGlyph name={track.locked ? 'lock' : 'unlock'} />
                    </ProButton>
                    <ProButton compact label="More" ariaLabel={`More for ${track.name}`} pressed={expanded} testId={IDS.more}
                      data={{ toggle: 'more' }} onPress={() => expand(track)}>
                      <ProGlyph name="more" />
                    </ProButton>
                  </span>
                </div>
                {expanded ? (
                  <div className="phone-tracks__more">
                    <div className="phone-tracks__rename">
                      <ProTextField label="Name" value={renameValue} testId={IDS.renameInput} onChange={setRenameValue} onSubmit={() => rename(track)} />
                      <ProButton label="Rename" testId={IDS.renameApply} onPress={() => rename(track)} />
                    </div>
                    <ProSection title="Colour">
                      <div className="phone-pro-chips" role="group" aria-label="Track colour">
                        {PHONE_TRACK_COLORS.map((entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            className="phone-tracks__swatch"
                            aria-label={entry.name}
                            aria-pressed={(track.labelColor ?? 'none') === entry.key}
                            data-testid={`${IDS.color}-${entry.key}`}
                            style={{ background: entry.key === 'none' ? undefined : entry.hex }}
                            onPointerUp={blurAfterPointer}
                            onClick={() => change((store) => store.setTrackLabelColor(track.id, entry.key as LabelColor))}
                          >
                            {entry.key === 'none' ? '∅' : ''}
                          </button>
                        ))}
                      </div>
                    </ProSection>
                    <ProSection title="Height">
                      <div className="phone-pro-chips" role="group" aria-label="Track height">
                        {PHONE_TRACK_HEIGHTS.map((preset) => (
                          <ProButton
                            key={preset.id}
                            compact
                            label={preset.label}
                            pressed={nearestPhoneTrackHeight(track.height) === preset.id}
                            testId={`${IDS.height}-${preset.id}`}
                            onPress={() => change((store) => store.setTrackHeight(track.id, preset.height))}
                          />
                        ))}
                      </div>
                    </ProSection>
                    {track.type === 'audio' || track.type === 'midi' ? (
                      <PhoneTrackAudioRows
                        track={track}
                        onVolume={(volumeDb) => change((store) => store.setTrackAudioVolumeDb(track.id, volumeDb))}
                        onPan={(pan) => change((store) => store.setTrackAudioPan(track.id, pan))}
                        onEditNotes={track.type === 'midi' ? () => editNotes(track) : undefined}
                      />
                    ) : null}
                    <div className="phone-pro-row__actions">
                      <ProButton compact label="Move up" testId={IDS.moveUp} unavailableReason={lockedReason} onPress={() => move(track, 'up')} />
                      <ProButton compact label="Move down" testId={IDS.moveDown} unavailableReason={lockedReason} onPress={() => move(track, 'down')} />
                      <ProButton
                        compact
                        label={targeted ? 'Target: on' : 'Target'}
                        pressed={targeted}
                        testId={IDS.target}
                        unavailableReason={lockedReason ?? (isVideo && hidden ? 'Show the track first.' : null)}
                        onPress={() => change((store) => store.setTargetTrack(track.id))}
                      />
                      <ProButton compact label="Delete" tone="danger" testId={IDS.remove} unavailableReason={phoneTrackDeleteReason(track)} onPress={() => remove(track)} />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <ProSection title="Add track">
          <div className="phone-tracks__add">
            <ProButton label="Video" testId={IDS.addVideo} ariaLabel="Add video track" onPress={() => addTrack('video')}>
              <ProGlyph name="track-video" /> Video
            </ProButton>
            <ProButton label="Audio" testId={IDS.addAudio} ariaLabel="Add audio track" onPress={() => addTrack('audio')}>
              <ProGlyph name="track-audio" /> Audio
            </ProButton>
            <ProButton label="MIDI" testId={IDS.addMidi} ariaLabel="Add MIDI track" onPress={() => addTrack('midi')}>
              <ProGlyph name="track-midi" /> MIDI
            </ProButton>
          </div>
        </ProSection>
        <ProButton label="Mixer: sends, track effects, master" testId={IDS.mixer} onPress={() => { void leaveTo(() => { openPhoneEditor('mixer'); }); }} />
      </div>
    </PhoneSheet>
  );
};

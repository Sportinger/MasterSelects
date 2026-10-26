// The template project every tutorial episode starts from, and an episode's project made from it (Save As), in the
// cut editor through the AI bridge (see scripts/tutorial-ms-cut.mjs for how the editor is found).
//
//   node scripts/tutorial-ms-template.mjs create [--music <file>] [--music-db -22]
//       makes the template: ~/Documents/MasterSelects-Tutorials/_Template, the tracks of a cut (Captions above
//       Picture, Voice, Music) and the music laid in from 0 at its level, faded in. Change it in MasterSelects as you
//       like (another music, an intro …) and save; every later episode gets it.
//   node scripts/tutorial-ms-template.mjs new <tutorial name>
//       opens the template and saves it as ~/Documents/MasterSelects-Tutorials/<tutorial name>: every tutorial starts
//       from zero, from the template, never from an earlier tutorial's project.
//
//   [--editor <origin>] [--tab <tabId>]   the cut editor; [--root <folder>] instead of ~/Documents/MasterSelects-Tutorials
//
// Both need the root folder granted once in that editor (grantWorkspaceRoot, Roman clicks it). The episode's parts
// then go in with tutorial-ms-cut.mjs, and tutorial-ms-finish.mjs ends the music with the episode and exports it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TRACKS, cutEditor, ensureTrack } from './tutorial-ms-cut.mjs';

const option = (args, name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
export const TEMPLATE_NAME = '_Template';

async function createTemplate(call, root, { music, level }) {
  const directory = path.join(root, TEMPLATE_NAME).replace(/\\/g, '/');
  await call('createLocalProject', { directory }, { timeoutMs: 60000 });
  let state = await call('getTimelineState');
  // A new project's default tracks hold nothing in a cut.
  for (const track of [...state.videoTracks, ...state.audioTracks]) if (!track.clips.length) await call('deleteTrack', { trackId: track.id });
  state = await call('getTimelineState');
  // The order of tutorial-ms-cut.mjs: Picture, then Captions above it.
  for (const [type, name] of [['video', TRACKS.picture], ['video', TRACKS.captions], ['audio', TRACKS.voice], ['audio', TRACKS.music]]) {
    await ensureTrack(call, state, type, name);
  }
  state = await call('getTimelineState');
  const musicTrack = state.audioTracks.find(track => track.name === TRACKS.music).id;
  const placed = await call('importLocalFiles', { paths: [music.replace(/\\/g, '/')], addToTimeline: true, trackId: musicTrack, startTime: 0 });
  const clipId = placed.placedClips?.[0]?.clipId;
  if (!clipId) throw new Error(`music: not placed (${JSON.stringify(placed.errors ?? placed).slice(0, 200)})`);
  const { effectId } = await call('addEffect', { clipId, effectType: 'audio-volume', params: { volume: level } });
  await call('addKeyframe', { clipId, effectId, keys: { volume: [[0, 0, 'linear'], [0.6, level, 'hold']] } });
  await call('saveProject');
  console.log(`template: ${directory} (tracks ${TRACKS.captions}, ${TRACKS.picture}, ${TRACKS.voice}, ${TRACKS.music}; music ${path.basename(music)} at ${(20 * Math.log10(level)).toFixed(0)} dB)`);
}

async function episodeProject(call, root, episode) {
  // The editor checks the folders (they live where the editor's grant points, which may be its own storage).
  const template = path.join(root, TEMPLATE_NAME), target = path.join(root, episode);
  await call('openLocalProject', { directory: template.replace(/\\/g, '/') }, { timeoutMs: 60000 })
    .catch(error => { throw new Error(`the template does not open (${error.message}); make it with: node scripts/tutorial-ms-template.mjs create`); });
  await call('saveLocalProjectAs', { directory: target.replace(/\\/g, '/') }, { timeoutMs: 60000 });
  console.log(`episode project: ${target} (from the template)`);
}

export async function main(args) {
  const [mode, episode] = args.filter((arg, index) => !arg.startsWith('--') && !['--music', '--music-db', '--editor', '--tab', '--root'].includes(args[index - 1]));
  const root = path.resolve(option(args, '--root', path.join(os.homedir(), 'Documents', 'MasterSelects-Tutorials')));
  if (mode !== 'create' && !(['new', 'episode'].includes(mode) && episode)) throw new Error('Usage: tutorial-ms-template.mjs create | new <tutorial name>');
  // A new project is no cut project yet: name the editor by its origin (and tab) if more than one is running.
  const call = await cutEditor(option(args, '--editor'), option(args, '--tab'), { anyProject: true });
  if (mode === 'create') {
    const music = path.resolve(option(args, '--music', path.join(import.meta.dirname, 'tutorials', 'audio', 'tutorial-music.wav')));
    if (!fs.existsSync(music)) throw new Error(`no music file at ${music}`);
    await createTemplate(call, root, { music, level: 10 ** (Number(option(args, '--music-db', -22)) / 20) });
  } else await episodeProject(call, root, episode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(`tutorial-ms-template: ${error.message}`);
    process.exit(1);
  });
}

// The cut in MasterSelects: puts recorded parts (their picture and voice lines, from <part>.cut/edl.json, see
// scripts/tutorial-video.mjs) into the project that is open in a running MasterSelects editor, through the AI bridge.
// The episode is then cut there like any other video: lines split, moved, trimmed, music added, export.
//
//   node scripts/tutorial-ms-cut.mjs <part recipe | edl.json> [<more parts> …]
//       [--editor http://localhost:5173]   the editor's dev server (default: the main folder's dev:full); a worktree's
//                                          own Vite writes its bridge token only when started with
//                                          MASTERSELECTS_BRIDGE_TOKEN_FILE=.ai-bridge-token
//       [--tab <tabId>]                    the editor tab, when more than one visible editor is connected (the
//                                          headless editors of takes and the build server are passed over)
//       [--at <seconds>]                   where the (first) part starts; default: after the last part
//       [--replace]                        a part that is already in the timeline is taken out and put in again
//       [--no-captions]                    no caption clips
//
// Tracks, found by name and created on first use: the video track "Picture" holds the parts one after another, the
// audio track "Voice" holds one clip per line, and the video track "Captions" above the picture holds one caption
// clip per part. A caption clip shows the words of the voice clip under it (setClipTranscript gives every line its
// ElevenLabs word times), so captions stay with a line that is split or moved.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TRACKS = { picture: 'Picture', voice: 'Voice', captions: 'Captions' };
// The look of the burned-in captions of earlier tutorials: bold white words, a dark outline, the spoken word in gold.
const CAPTION_STYLE = {
  wordsPerCaption: 4, gapThreshold: 0.6, holdAfter: 0.35, maxLines: 1, maxWidth: 80,
  textStyle: { fontWeight: 800, fontSize: 64, color: '#ffffff', strokeEnabled: true, strokeColor: '#101010', strokeWidth: 5,
    shadowEnabled: true, shadowColor: 'rgba(0,0,0,0.6)', shadowOffsetX: 0, shadowOffsetY: 2, shadowBlur: 6 },
  highlight: { enabled: true, mode: 'active-word', style: 'text', textColor: '#ffd234', scaleEnabled: false },
  background: { enabled: false },
};

const option = (args, name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };

/** The folder of the main checkout (whose dev:full serves the editor on 5173), seen from any worktree. */
function mainFolder() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim();
  return path.dirname(common);
}

/** The bridge of the editor at `origin`: its token comes from the checkout whose dev server writes that origin. */
function bridgeFor(origin) {
  const folders = [path.resolve(import.meta.dirname, '..'), mainFolder()];
  for (const folder of folders) {
    const urlFile = path.join(folder, '.ai-bridge-url'), tokenFile = path.join(folder, '.ai-bridge-token');
    if (!fs.existsSync(urlFile) || !fs.existsSync(tokenFile)) continue;
    if (new URL(fs.readFileSync(urlFile, 'utf8').trim()).origin !== new URL(origin).origin) continue;
    return { origin: new URL(origin).origin, token: fs.readFileSync(tokenFile, 'utf8').trim() };
  }
  throw new Error(`No bridge token for ${origin}: start the editor's dev server (npm run dev:full in ${mainFolder()}) and open the editor there`);
}

/** Calls editor tools in one tab through the bridge. */
async function connect({ origin, token }, tab) {
  const status = await (await fetch(`${origin}/api/ai-tools`)).json().catch(() => ({ clientTabs: [] }));
  // A closed tab stays listed for a while without a heartbeat. The editors of takes and of the build server
  // (tab ids "tutorial-…", set by scripts/tutorialSession.mjs) are never the cut editor.
  const live = (status.clientTabs ?? []).filter(item => item.lastSeenAgoMs < 10000);
  const tabs = tab ? (status.clientTabs ?? []).filter(item => item.tabId === tab) : live.filter(item => !item.tabId.startsWith('tutorial-'));
  if (!tabs.length) {
    throw new Error(tab ? `Tab ${tab} is not connected to ${origin} (connected: ${live.map(item => item.tabId).join(', ') || 'none'})`
      : `No cut editor is connected to ${origin}${live.length ? ` (only the take's headless editor)` : ''}: open ${origin}/editor in a visible tab with the episode's project`);
  }
  if (!tab && tabs.length > 1) {
    throw new Error(`${tabs.length} editor tabs are connected to ${origin}; name one with --tab: ${tabs.map(item => `${item.tabId} (${item.visibilityState}${item.hasFocus ? ', focused' : ''})`).join(', ')}`);
  }
  const targetTabId = tab ?? tabs[0].tabId;
  return async (tool, args = {}) => {
    const response = await fetch(`${origin}/api/ai-tools`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args, targetTabId }),
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { throw new Error(`${tool}: HTTP ${response.status} ${text.slice(0, 200)}`); }
    if (!response.ok || result.success === false) throw new Error(`${tool}: ${result.error ?? JSON.stringify(result).slice(0, 300)}`);
    return result.data ?? result;
  };
}

/** The edit list of a part: the edl.json itself, or the one a recipe's take wrote. */
export function readEdl(file, out = path.resolve(import.meta.dirname, '..', 'tutorial-videos')) {
  const edlFile = file.endsWith('edl.json') ? path.resolve(file) : path.join(out, `${JSON.parse(fs.readFileSync(file, 'utf8')).name}.cut`, 'edl.json');
  if (!fs.existsSync(edlFile)) throw new Error(`${edlFile} is missing: record the part first (node scripts/tutorial-tab.mjs make ${file})`);
  const edl = JSON.parse(fs.readFileSync(edlFile, 'utf8'));
  if (!edl.lines?.length) console.warn(`${edl.name}: the take has no voice (--voice none); only its picture goes in.`);
  return edl;
}

/** The part's clips already in the timeline: its picture and its lines, recognised by their file names. */
export function partClips(state, name) {
  const all = [...state.videoTracks, ...state.audioTracks].flatMap(track => track.clips.map(clip => ({ ...clip, trackName: track.name })));
  return all.filter(clip => clip.name === `${name}.mp4` || clip.name.startsWith(`${name}.`) && clip.name.endsWith('.wav'));
}

/** Where captions go for each run of lines with the same place (bottom or top): [{ top, start, end }] in part seconds. */
export function captionRuns(lines, duration) {
  const runs = [];
  for (const line of lines) {
    const top = Boolean(line.top);
    if (runs.at(-1)?.top === top) continue;
    if (runs.length) runs.at(-1).end = line.at;
    runs.push({ top, start: runs.length ? line.at : 0, end: duration });
  }
  return runs;
}

async function ensureTrack(call, state, type, name) {
  const tracks = type === 'video' ? state.videoTracks : state.audioTracks;
  const found = tracks.find(track => track.name === name);
  if (found) return found.id;
  const { trackId } = await call('createTrack', { type, name });
  console.log(`  track "${name}" created`);
  return trackId;
}

async function placePart(call, edl, { at, replace, captions }) {
  let state = await call('getTimelineState');
  const old = partClips(state, edl.name);
  if (old.length && !replace) throw new Error(`${edl.name} is already in the timeline (${old.length} clips); --replace takes it out and puts the new take in`);
  const pictureTrack = await ensureTrack(call, state, 'video', TRACKS.picture);
  // Created after the picture track, so it lies above it (a new video track goes on top).
  const captionTrack = captions ? await ensureTrack(call, state, 'video', TRACKS.captions) : null;
  const voiceTrack = await ensureTrack(call, state, 'audio', TRACKS.voice);
  state = await call('getTimelineState');
  const videoOrder = state.videoTracks.map(track => track.id);
  if (captionTrack && videoOrder.indexOf(captionTrack) > videoOrder.indexOf(pictureTrack)) {
    console.warn(`  NOTE: track "${TRACKS.captions}" lies below "${TRACKS.picture}"; the picture covers the captions. Drag it above.`);
  }

  let start = at;
  if (old.length) {
    const oldPicture = old.find(clip => clip.name === `${edl.name}.mp4`);
    start ??= oldPicture?.startTime;
    const oldEnd = Math.max(...old.map(clip => clip.endTime));
    const next = state.videoTracks.find(track => track.id === pictureTrack).clips
      .filter(clip => clip.startTime >= oldEnd - 0.01 && !old.some(item => item.id === clip.id)).toSorted((a, b) => a.startTime - b.startTime)[0];
    if (next && start + edl.duration > next.startTime + 0.01) {
      throw new Error(`the new take of ${edl.name} (${edl.duration.toFixed(2)} s) would run into ${next.name} at ${next.startTime.toFixed(2)} s; move the later parts first`);
    }
    const captionClips = captionTrack ? state.videoTracks.find(track => track.id === captionTrack).clips
      .filter(clip => clip.startTime < oldEnd - 0.01 && clip.endTime > (oldPicture?.startTime ?? 0) + 0.01) : [];
    await call('deleteClips', { clipIds: [...old, ...captionClips].map(clip => clip.id) });
    console.log(`  took out the old take (${old.length + captionClips.length} clips)`);
  }
  if (start === undefined) {
    start = Math.max(0, ...state.videoTracks.find(track => track.id === pictureTrack).clips.map(clip => clip.endTime));
  }

  const picture = await call('importLocalFiles', { paths: [edl.picture.replace(/\\/g, '/')], addToTimeline: true, trackId: pictureTrack, startTime: start });
  if (!picture.placedClips?.length) throw new Error(`${edl.name}: the picture was not placed (${JSON.stringify(picture.errors ?? picture).slice(0, 200)})`);
  console.log(`  picture ${edl.name}.mp4 at ${start.toFixed(2)} s (${edl.duration.toFixed(2)} s)`);

  let transcripts = 0;
  for (const line of edl.lines ?? []) {
    const placed = await call('importLocalFiles', { paths: [line.file.replace(/\\/g, '/')], addToTimeline: true, trackId: voiceTrack, startTime: start + line.at });
    const clipId = placed.placedClips?.[0]?.clipId;
    if (!clipId) throw new Error(`line ${line.id}: not placed (${JSON.stringify(placed.errors ?? placed).slice(0, 200)})`);
    if (captions && line.words?.length) {
      try {
        await call('setClipTranscript', { clipId, words: line.words });
        transcripts += 1;
      } catch (error) {
        // An editor without this tool (older checkout) still gets the cut, only without captions.
        console.warn(`  line ${line.id}: no transcript (${error.message}); its captions stay empty`);
      }
    }
    console.log(`  line ${line.id} at ${(start + line.at).toFixed(2)} s`);
  }

  if (captions && transcripts) {
    for (const run of captionRuns(edl.lines, edl.duration)) {
      await call('createCaptionClip', { trackId: captionTrack, startTime: start + run.start, duration: run.end - run.start, sourceClipId: null,
        positionX: 50, positionY: run.top ? 12 : 88, ...CAPTION_STYLE });
    }
    console.log(`  captions over ${edl.duration.toFixed(2)} s`);
  }
  return start + edl.duration;
}

export async function main(args) {
  const valued = ['--editor', '--tab', '--at'];
  const files = args.filter((arg, index) => !arg.startsWith('--') && !valued.includes(args[index - 1]));
  if (!files.length) throw new Error('Name a part recipe or its edl.json, e.g. scripts/tutorials/flamer-ep2-part3-yarn.json');
  const call = await connect(bridgeFor(option(args, '--editor', 'http://localhost:5173')), option(args, '--tab'));
  let at = option(args, '--at') === undefined ? undefined : Number(option(args, '--at'));
  for (const file of files) {
    const edl = readEdl(file);
    console.log(`${edl.name}:`);
    const end = await placePart(call, edl, { at, replace: args.includes('--replace'), captions: !args.includes('--no-captions') });
    at = at === undefined ? undefined : end;
  }
  await call('saveProject').then(() => console.log('project saved'), error => console.warn(`project not saved: ${error.message}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(`tutorial-ms-cut: ${error.message}`);
    process.exit(1);
  });
}

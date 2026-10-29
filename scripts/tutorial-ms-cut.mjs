// The cut in MasterSelects: puts recorded parts (their picture and voice lines, from <part>.cut/edl.json, see
// scripts/tutorial-video.mjs) into the project that is open in a running MasterSelects editor, through the AI bridge.
// The episode is then cut there like any other video: lines split, moved, trimmed, music added, export.
//
//   node scripts/tutorial-ms-cut.mjs <part recipe | edl.json> [<more parts> …]
//       [--editor <origin>]                the cut editor's dev server; default: the first of the main folder's
//                                          dev:full and this worktree's Vite whose editor holds a cut project
//                                          (a worktree's Vite writes its bridge token only when started with
//                                          MASTERSELECTS_BRIDGE_TOKEN_FILE=.ai-bridge-token)
//       [--tab <tabId>]                    the editor tab, when more than one visible editor is connected (the
//                                          headless editors of takes and the build server are passed over)
//       [--at <seconds>]                   where the (first) part starts; default: after the last part
//       [--replace]                        a part that is already in the timeline is taken out and put in again
//       [--no-captions]                    no caption clips
//
// Tracks, found by name and created on first use: the video track "Picture" holds the parts one after another, the
// audio track "Voice" holds one clip per line, and the video track "Captions" above the picture holds one caption
// clip per part. Parts only go into a cut project: one with the track "Picture", or an empty one, never a project
// someone works on. A take (scripts/tutorial-video.mjs) calls this after every voiced part. A caption clip shows the words of the voice clip under it (setClipTranscript gives every line its
// ElevenLabs word times), so captions stay with a line that is split or moved.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TRACKS = { picture: 'Picture', voice: 'Voice', captions: 'Captions', music: 'Music' };
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
  const status = await fetch(`${origin}/api/ai-tools`).then(response => response.json().catch(() => ({ clientTabs: [] })), () => null);
  if (!status) throw new Error(`no dev server answers at ${origin}`);
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
  // `timeoutMs`: how long the bridge waits for the tab (30 s by default; an export takes longer).
  return async (tool, args = {}, { timeoutMs } = {}) => {
    const response = await fetch(`${origin}/api/ai-tools`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args, targetTabId, ...(timeoutMs ? { timeoutMs } : {}) }),
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { throw new Error(`${tool}: HTTP ${response.status} ${text.slice(0, 200)}`); }
    if (!response.ok || result.success === false) throw new Error(`${tool}: ${result.error ?? JSON.stringify(result).slice(0, 300)}`);
    return result.data ?? result;
  };
}

/** The origins of the dev servers that may hold the cut editor: the main folder's dev:full, then this worktree's Vite. */
function knownOrigins() {
  return [...new Set([mainFolder(), path.resolve(import.meta.dirname, '..')].map(folder => path.join(folder, '.ai-bridge-url'))
    .filter(file => fs.existsSync(file)).map(file => new URL(fs.readFileSync(file, 'utf8').trim()).origin))];
}

/** Whether the open project is a cut project: it has the track "Picture", or nothing at all yet. */
export function isCutProject(state) {
  const tracks = [...state.videoTracks, ...state.audioTracks];
  return tracks.some(track => track.name === TRACKS.picture) || tracks.every(track => !track.clips.length);
}

/**
 * The cut editor: --editor, else the first known dev server whose editor holds a cut project. `anyProject`: any open
 * project will do (tutorial-ms-template.mjs opens the template or creates a project itself).
 */
export async function cutEditor(editor, tab, { anyProject = false } = {}) {
  const reasons = [];
  for (const origin of editor ? [new URL(editor).origin] : knownOrigins()) {
    try {
      const call = await connect(bridgeFor(origin), tab);
      if (anyProject || isCutProject(await call('getTimelineState'))) {
        console.log(`cut editor: ${origin}/editor`);
        return call;
      }
      reasons.push(`the project open at ${origin} is no cut project (it has clips and no track "${TRACKS.picture}")`);
    } catch (error) {
      reasons.push(error.message);
    }
  }
  throw new Error(`no cut editor: ${reasons.join('; ') || 'no dev server has written a bridge token'}. Open the episode's project (or a new one)`
    + ' in a visible editor tab, or name the editor with --editor');
}

/** The edit list of a part: the edl.json itself, or the one a recipe's take wrote. */
export function readEdl(file, out = path.resolve(import.meta.dirname, '..', 'tutorial-videos')) {
  const edlFile = file.endsWith('edl.json') ? path.resolve(file) : path.join(out, `${JSON.parse(fs.readFileSync(file, 'utf8')).name}.cut`, 'edl.json');
  if (!fs.existsSync(edlFile)) throw new Error(`${edlFile} is missing: record the part first (node scripts/tutorial-tab.mjs make ${file})`);
  const edl = JSON.parse(fs.readFileSync(edlFile, 'utf8'));
  if (!edl.lines?.length) console.warn(`${edl.name}: the take has no voice (--voice none); only its picture goes in.`);
  return edl;
}

/**
 * Whether a clip or media name belongs to the part `name`: its picture `<name>.mp4` or a line `<name>.NN-<scene>.wav`.
 * A file imported again gets a hash before its extension (`old-tv-3-4f803cd84654998c.mp4`), which counts as well.
 */
export function isPartName(fileName, name, kind) {
  const part = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), hash = '(?:-[0-9a-f]{6,})?';
  return new RegExp(kind === 'picture' ? `^${part}${hash}\\.mp4$` : kind === 'line' ? `^${part}\\.\\d\\d-.+?${hash}\\.wav$`
    : `^(?:${part}${hash}\\.mp4|${part}\\.\\d\\d-.+?${hash}\\.wav)$`).test(fileName);
}

/** The part's clips already in the timeline: its picture and its lines, recognised by their file names. */
export function partClips(state, name) {
  const all = [...state.videoTracks, ...state.audioTracks].flatMap(track => track.clips.map(clip => ({ ...clip, trackName: track.name })));
  return all.filter(clip => isPartName(clip.name, name));
}

/**
 * The camera of a part as keyframes of its picture clip: { 'scale.x', 'scale.y', 'position.x', 'position.y' } →
 * [[seconds of the clip, value, easing]]. `segments` come from the take (cameraSegments in scripts/tutorialCut.mjs,
 * framings in take pixels); `base` is the scale at which the whole take fills the composition. A framing
 * { cx, cy, zoom } puts take point (cx, cy) in the middle of the composition at base × zoom.
 */
export function cameraKeyframes(segments, { viewport, base }) {
  const points = [];
  const put = (t, framing, easing) => {
    const last = points.at(-1);
    if (last && Math.abs(last.t - t) < 0.005) points.pop();
    else if (last) last.easing = last.easing === 'cubic-in-out' && last.moving ? last.easing : 'hold';
    points.push({ t, framing, easing, moving: easing === 'cubic-in-out' });
  };
  for (const segment of segments.toSorted((a, b) => a.at - b.at)) {
    if (segment.ms > 0) {
      put(segment.at, segment.from, 'cubic-in-out');
      put(segment.at + segment.ms / 1000, segment.to, 'hold');
    } else put(segment.at, segment.to, 'hold');
  }
  if (!points.length || points[0].t > 0.005) points.unshift({ t: 0, framing: { cx: viewport.width / 2, cy: viewport.height / 2, zoom: 1 }, easing: 'hold' });
  points[0].t = 0;
  const value = { 'scale.x': f => base * f.zoom, 'scale.y': f => base * f.zoom,
    'position.x': f => -(f.cx - viewport.width / 2) * base * f.zoom, 'position.y': f => -(f.cy - viewport.height / 2) * base * f.zoom };
  return Object.fromEntries(Object.entries(value).map(([property, of]) => [property,
    points.map(point => [Number(point.t.toFixed(3)), Number(of(point.framing).toFixed(4)), point.easing])]));
}

/** Moves clips by `delta` seconds, in an order in which no clip runs into one not moved yet. */
async function shiftClips(call, clips, delta) {
  if (Math.abs(delta) < 0.001) return;
  for (const clip of clips.toSorted((a, b) => delta > 0 ? b.startTime - a.startTime : a.startTime - b.startTime)) {
    await call('moveClip', { clipId: clip.id, newStartTime: clip.startTime + delta });
  }
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

export async function ensureTrack(call, state, type, name) {
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
  // A retake replaces the part where it was: the old clips, its captions and its media go, and the later parts move
  // by the difference in length (a shorter take leaves no gap, a longer one does not run into the next part).
  let later = [];
  if (old.length) {
    const oldPicture = old.find(clip => isPartName(clip.name, edl.name, 'picture'));
    const oldStart = oldPicture?.startTime ?? Math.min(...old.map(clip => clip.startTime));
    const oldEnd = Math.max(...old.map(clip => clip.endTime));
    start ??= oldStart;
    const cutTracks = [...state.videoTracks, ...state.audioTracks].filter(track => [pictureTrack, captionTrack, voiceTrack].includes(track.id));
    const inPart = clip => clip.startTime >= oldStart - 0.01 && clip.endTime <= oldEnd + 0.01;
    const captionClips = captionTrack ? cutTracks.find(track => track.id === captionTrack).clips.filter(inPart) : [];
    later = cutTracks.flatMap(track => track.clips).filter(clip => clip.startTime >= oldEnd - 0.01 && !old.some(item => item.id === clip.id));
    await call('deleteClips', { clipIds: [...old, ...captionClips].map(clip => clip.id) });
    console.log(`  took out the old take (${old.length + captionClips.length} clips)`);
    // Its media items too, so the Media panel keeps one picture and one file per line of each part.
    const used = new Set([...state.videoTracks, ...state.audioTracks].flatMap(track => track.clips)
      .filter(clip => !old.some(item => item.id === clip.id)).map(clip => clip.name));
    const media = (await call('getMediaItems', { recursive: true })).files ?? [];
    for (const item of media.filter(file => isPartName(file.name, edl.name) && !used.has(file.name))) {
      await call('deleteMediaItem', { itemId: item.id }).catch(error => console.warn(`  media ${item.name} stays: ${error.message}`));
    }
    // Room for a longer take before it goes in; the exact shift follows once the picture is placed.
    await shiftClips(call, later, Math.max(0, edl.duration - (oldEnd - oldStart)) + 0.1);
    later = later.map(clip => ({ ...clip, startTime: clip.startTime + Math.max(0, edl.duration - (oldEnd - oldStart)) + 0.1 }));
  }
  if (start === undefined) {
    start = Math.max(0, ...state.videoTracks.find(track => track.id === pictureTrack).clips.map(clip => clip.endTime));
  }

  const picture = await call('importLocalFiles', { paths: [edl.picture.replace(/\\/g, '/')], addToTimeline: true, trackId: pictureTrack, startTime: start });
  if (!picture.placedClips?.length) throw new Error(`${edl.name}: the picture was not placed (${JSON.stringify(picture.errors ?? picture).slice(0, 200)})`);
  // Lines and captions follow the picture clip as the editor placed it (on whole frames), not the take's own
  // length: a caption that ran past the picture overlapped the next part's caption.
  const placed = (await call('getTimelineState')).videoTracks.flatMap(track => track.clips).find(clip => clip.id === picture.placedClips[0].clipId);
  if (placed) start = placed.startTime;
  const length = placed ? placed.endTime - placed.startTime : edl.duration;
  console.log(`  picture ${edl.name}.mp4 at ${start.toFixed(2)} s (${length.toFixed(2)} s)`);
  // The take is larger than the episode (2560×1440 in 1080p): it fills the frame at `base`, and the recipe's camera
  // moves become keyframes of the clip, which can be changed in MasterSelects.
  if (placed && edl.size) {
    const { activeCompositionId } = await call('getTimelineState');
    const frame = ((await call('getMediaItems', { recursive: true })).compositions ?? []).find(item => item.id === activeCompositionId);
    if (!frame?.width) throw new Error(`the open composition (${activeCompositionId}) reports no size; the camera cannot be placed`);
    const base = Math.max(frame.width / edl.size.width, frame.height / edl.size.height);
    const keys = cameraKeyframes(edl.camera ?? [], { viewport: edl.size, base });
    await call('setTransform', { clipId: placed.id, x: keys['position.x'][0][1], y: keys['position.y'][0][1], scaleX: keys['scale.x'][0][1], scaleY: keys['scale.y'][0][1] });
    if (keys['scale.x'].length > 1) await call('addKeyframe', { clipId: placed.id, keys });
    console.log(`  camera: ${keys['scale.x'].length - 1} keyframes on the picture (take ${edl.size.width}×${edl.size.height} in ${frame.width}×${frame.height})`);
  }
  if (later.length) {
    const delta = start + length - Math.min(...later.map(clip => clip.startTime));
    await shiftClips(call, later, delta);
    console.log(`  the later parts follow at ${(start + length).toFixed(2)} s`);
  }

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
    for (const run of captionRuns(edl.lines, length)) {
      await call('createCaptionClip', { trackId: captionTrack, startTime: start + run.start, duration: run.end - run.start, sourceClipId: null,
        positionX: 50, positionY: run.top ? 12 : 88, ...CAPTION_STYLE });
    }
    console.log(`  captions over ${length.toFixed(2)} s`);
  }
  return start + length;
}

export async function main(args) {
  const valued = ['--editor', '--tab', '--at'];
  const files = args.filter((arg, index) => !arg.startsWith('--') && !valued.includes(args[index - 1]));
  if (!files.length) throw new Error('Name a part recipe or its edl.json, e.g. scripts/tutorials/flamer-ep2-part3-yarn.json');
  const call = await cutEditor(option(args, '--editor'), option(args, '--tab'));
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

// Shared by tutorial-video.mjs: the narration of a tutorial. One ElevenLabs request speaks every
// scene's `say` in one go (one voice, one breath: prosody stays even across scenes) and returns the
// time of every character; the words are split back into the scenes, so the recording can wait for
// each scene's sentence and the captions can follow the words.
//
// The voice of every MasterSelects tutorial is "flamer" (FLAMER_VOICE, the default), an ElevenLabs voice
// of the account whose key is ELEVENLABS_BROWSER_API_KEY (else ELEVENLABS_API_KEY is used). Other voices:
// a voice id, or "male" / "female" from ELEVENLABS_VOICE_MALE / ELEVENLABS_VOICE_FEMALE with ELEVENLABS_API_KEY. The result is cached in the work folder by text,
// voice and settings, so a new recording or encode costs no second request.
//
// A recipe with `audio` brings its own recorded voice instead: Deepgram (DEEPGRAM_API_KEY) hears
// the words and their times, which are matched to the scenes' `say` (recordedNarration).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Spoken words of a text: audio tags such as [excited] are directions, not words. */
export const spokenWords = text => text.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean);

function audioDuration(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(result.stdout.trim());
}

/** Words with their times from ElevenLabs' character alignment, tags left out. */
export function alignmentWords({ characters, character_start_times_seconds: starts, character_end_times_seconds: ends }) {
  const words = [];
  let word, inTag = false;
  characters.forEach((char, index) => {
    if (char === '[') inTag = true;
    if (inTag || /\s/.test(char)) {
      if (word) words.push(word);
      word = undefined;
      if (char === ']') inTag = false;
      return;
    }
    if (!word) word = { text: '', start: starts[index], end: ends[index] };
    word.text += char;
    word.end = ends[index];
  });
  if (word) words.push(word);
  return words;
}

/**
 * Splits the timed words into the scenes (by their word counts) and sets each scene's audio cut:
 * halfway through the pause between two scenes, so no breath is cut off.
 */
export function splitScenes(scenes, words, duration) {
  const counts = scenes.map(scene => spokenWords(scene.say ?? '').length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total !== words.length) console.warn(`Narration: the voice returned ${words.length} words, the scenes have ${total}; captions may drift.`);
  let next = 0;
  const parts = scenes.map((scene, index) => {
    const share = total === words.length ? counts[index] : Math.round(counts[index] * words.length / (total || 1));
    const own = index === scenes.length - 1 ? words.slice(next) : words.slice(next, next + share);
    next += share;
    return { id: scene.id, words: own, start: own[0]?.start ?? 0, end: own.at(-1)?.end ?? 0 };
  });
  parts.forEach((part, index) => {
    const previous = parts.slice(0, index).findLast(item => item.words.length);
    const following = parts.slice(index + 1).find(item => item.words.length);
    part.cutFrom = previous ? (previous.end + part.start) / 2 : Math.max(0, part.start - 0.05);
    part.cutTo = following ? (part.end + following.start) / 2 : duration;
  });
  return parts;
}

/** Without a voice: words at an even talking pace, so timing and captions can be checked first. */
export function estimatedNarration(scenes, wordsPerSecond = 2.6) {
  let time = 0;
  const words = scenes.flatMap(scene => {
    const list = spokenWords(scene.say ?? '').map(text => {
      const word = { text, start: time, end: time + 1 / wordsPerSecond * 0.9 };
      time += 1 / wordsPerSecond;
      return word;
    });
    time += 0.6;
    return list;
  });
  return { file: null, scenes: splitScenes(scenes, words, time) };
}

const plain = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Times for the recipe's words from what a transcription heard: matched words (longest common
 * subsequence) take their heard times; a run of unmatched words shares the time of the unmatched
 * heard words between the same neighbours ("MasterSelects" ↔ "master selects"), or, with none,
 * follows the previous word briefly (a swallowed "I").
 */
export function matchWords(words, heard) {
  const a = words.map(plain), b = heard.map(word => plain(word.text));
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; } else if (table[i + 1][j] >= table[i][j + 1]) i += 1; else j += 1;
  }
  const timed = words.map(text => ({ text }));
  for (const [i, j] of pairs) Object.assign(timed[i], { start: heard[j].start, end: heard[j].end });
  const anchors = [[-1, -1], ...pairs, [a.length, b.length]];
  for (let k = 0; k + 1 < anchors.length; k += 1) {
    const [i0, j0] = anchors[k], [i1, j1] = anchors[k + 1], gap = timed.slice(i0 + 1, i1);
    if (!gap.length) continue;
    const spare = heard.slice(j0 + 1, j1);
    const from = spare[0]?.start ?? heard[j0]?.end ?? 0;
    const to = spare.at(-1)?.end ?? Math.min(from + 0.3 * gap.length, heard[j1]?.start ?? Infinity);
    gap.forEach((word, index) => Object.assign(word, { start: from + (to - from) * index / gap.length, end: from + (to - from) * (index + 1) / gap.length }));
  }
  return timed;
}

/** What Deepgram heard in a voice file: [{ text, start, end }], cached next to the work. */
async function transcribe(file, workDir) {
  const stat = fs.statSync(file);
  const key = createHash('sha256').update(`${path.resolve(file)}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 16);
  const cache = path.join(workDir, `transcript-${key}.json`);
  if (!fs.existsSync(cache)) {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set (needed to time the words of a recorded voice)');
    console.log(`Narration: transcribing ${path.basename(file)} with Deepgram …`);
    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&punctuate=true&language=en', {
      method: 'POST', headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(file),
    });
    if (!response.ok) throw new Error(`Deepgram ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const words = (await response.json()).results.channels[0].alternatives[0].words;
    fs.writeFileSync(cache, JSON.stringify(words.map(word => ({ text: word.punctuated_word ?? word.word, start: word.start, end: word.end }))));
  }
  return JSON.parse(fs.readFileSync(cache, 'utf8'));
}

/**
 * The narration from a recorded voice file (recipe.audio) instead of ElevenLabs: the scenes' `say`
 * must be its transcript (audio tags allowed); the word times come from a transcription.
 */
export async function recordedNarration(recipe, workDir, recipeDir = '.') {
  const file = path.resolve(recipeDir, recipe.audio.file ?? recipe.audio);
  if (!fs.existsSync(file)) throw new Error(`Voice file ${file} not found`);
  const withSay = recipe.scenes.filter(scene => scene.say);
  const heard = await transcribe(file, workDir);
  const words = matchWords(withSay.flatMap(scene => spokenWords(scene.say)), heard);
  const parts = splitScenes(withSay, words, audioDuration(file));
  return { file, recorded: true, scenes: recipe.scenes.map(scene => parts.find(part => part.id === scene.id) ?? { id: scene.id, words: [], start: 0, end: 0 }) };
}

/** The tutorial voice ("Dominik Flamer"): used for every MasterSelects tutorial. */
export const FLAMER_VOICE = 'nQ95rSg3xpIIuIQxL1w6';

function voiceId(voice) {
  const named = { flamer: FLAMER_VOICE, male: process.env.ELEVENLABS_VOICE_MALE, female: process.env.ELEVENLABS_VOICE_FEMALE };
  const id = voice in named ? named[voice] : voice;
  if (!id) throw new Error(`No ElevenLabs voice for "${voice}": set ELEVENLABS_VOICE_${voice.toUpperCase()} or name a voice id`);
  return id;
}

/** The narration of the recipe's scenes: { file, scenes: [{ id, words, start, end, cutFrom, cutTo }] }. */
export async function narrate(recipe, workDir, { voice: voiceOverride } = {}) {
  const settings = { voice: 'flamer', model: 'eleven_v3', stability: 0.5, prefix: '', ...recipe.voice };
  const voice = voiceId(voiceOverride ?? settings.voice);
  const text = recipe.scenes.filter(scene => scene.say).map((scene, index) => `${index === 0 && settings.prefix ? `${settings.prefix} ` : ''}${scene.say}`).join('\n\n');
  const key = createHash('sha256').update(JSON.stringify({ text, voice, model: settings.model, stability: settings.stability,
    ...(settings.similarity !== undefined && { similarity: settings.similarity }), ...(settings.speed !== undefined && { speed: settings.speed }) })).digest('hex').slice(0, 16);
  const file = path.join(workDir, `narration-${key}.mp3`), timing = path.join(workDir, `narration-${key}.json`);
  if (!fs.existsSync(file) || !fs.existsSync(timing)) {
    // The tutorial voice lives in another account than the male/female voices.
    const apiKey = (voice === FLAMER_VOICE && process.env.ELEVENLABS_BROWSER_API_KEY) || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set (or pass --voice none)');
    console.log(`Narration: ${spokenWords(text).length} words to ElevenLabs (${settings.model}) …`);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: settings.model, voice_settings: { stability: settings.stability,
        ...(settings.similarity !== undefined && { similarity_boost: settings.similarity }), ...(settings.speed !== undefined && { speed: settings.speed }) } }),
    });
    if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const result = await response.json();
    fs.writeFileSync(file, Buffer.from(result.audio_base64, 'base64'));
    fs.writeFileSync(timing, JSON.stringify(result.alignment));
  }
  const words = alignmentWords(JSON.parse(fs.readFileSync(timing, 'utf8')));
  const withSay = recipe.scenes.filter(scene => scene.say);
  const parts = splitScenes(withSay, words, audioDuration(file));
  return { file, scenes: recipe.scenes.map(scene => parts.find(part => part.id === scene.id) ?? { id: scene.id, words: [], start: 0, end: 0 }) };
}

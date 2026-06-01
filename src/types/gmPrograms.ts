// General MIDI program + drum-kit names (issue #193, Phase 6).
//
// The canonical GM Level 1 sound set: 128 melodic program names grouped into the 16
// standard families, plus the common GS/GM2 drum kits. This is *naming/UI data only*
// — it's independent of which assets actually exist. The picker lists every program;
// programs without a generated asset simply fetch nothing and the track stays silent
// (GmSampleBank degrades gracefully). Real sounds arrive with the FluidR3 converter (2b).

/** The 128 GM program names, indexed by program number (0–127). */
export const GM_PROGRAM_NAMES: readonly string[] = [
  // Piano (0–7)
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  // Chromatic Percussion (8–15)
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  // Organ (16–23)
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
  'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  // Guitar (24–31)
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  // Bass (32–39)
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  // Strings (40–47)
  'Violin', 'Viola', 'Cello', 'Contrabass',
  'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  // Ensemble (48–55)
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  // Brass (56–63)
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
  'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  // Reed (64–71)
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
  'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  // Pipe (72–79)
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
  'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  // Synth Lead (80–87)
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  // Synth Pad (88–95)
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  // Synth Effects (96–103)
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  // Ethnic (104–111)
  'Sitar', 'Banjo', 'Shamisen', 'Koto',
  'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  // Percussive (112–119)
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
  'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  // Sound Effects (120–127)
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
  'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

export interface GmFamily {
  name: string;
  programs: number[]; // 8 consecutive GM program numbers
}

/** The 16 standard GM families, each covering 8 consecutive programs. */
export const GM_FAMILIES: readonly GmFamily[] = [
  'Piano', 'Chromatic Percussion', 'Organ', 'Guitar',
  'Bass', 'Strings', 'Ensemble', 'Brass',
  'Reed', 'Pipe', 'Synth Lead', 'Synth Pad',
  'Synth Effects', 'Ethnic', 'Percussive', 'Sound Effects',
].map((name, i) => ({ name, programs: Array.from({ length: 8 }, (_, j) => i * 8 + j) }));

export interface GmDrumKit {
  program: number;
  name: string;
}

/** Common GM/GS drum kits, selected by program number on the percussion channel. */
export const GM_DRUM_KITS: readonly GmDrumKit[] = [
  { program: 0, name: 'Standard Kit' },
  { program: 8, name: 'Room Kit' },
  { program: 16, name: 'Power Kit' },
  { program: 24, name: 'Electronic Kit' },
  { program: 25, name: 'TR-808 Kit' },
  { program: 32, name: 'Jazz Kit' },
  { program: 40, name: 'Brush Kit' },
  { program: 48, name: 'Orchestra Kit' },
  { program: 56, name: 'SFX Kit' },
];

// ── Release availability (issue #193) ────────────────────────────────────────────
// The full GM_PROGRAM_NAMES / GM_FAMILIES / GM_DRUM_KITS above are the complete GM set
// and stay intact. But only a curated subset ships as committed assets in the "lite"
// release, so the pickers below offer ONLY those — users never land on a silent
// instrument. When the full set is hosted, widen the pickers by setting
// GM_PICKER_FAMILIES = GM_FAMILIES and GM_PICKER_DRUM_KITS = GM_DRUM_KITS (or point them
// at a larger availability list). Keep GM_LITE_PROGRAMS in sync with LITE_PROGRAMS in
// scripts/build-gm-instruments.mjs.

/** Melodic programs whose assets ship in the committed lite set. */
export const GM_LITE_PROGRAMS: readonly number[] = [
  0, 4, 11, 12, 16, 19, 25, 27, 32, 33, 38, 40, 48, 52, 56, 60, 65, 73, 81, 89,
];

/** Drum-kit program numbers whose assets ship in the committed lite set. */
export const GM_LITE_DRUM_KITS: readonly number[] = [0];

/** Families shown in the program picker — lite programs only, empty families dropped. */
export const GM_PICKER_FAMILIES: readonly GmFamily[] = GM_FAMILIES
  .map((family) => ({
    name: family.name,
    programs: family.programs.filter((p) => GM_LITE_PROGRAMS.includes(p)),
  }))
  .filter((family) => family.programs.length > 0);

/** Drum kits shown in the drum-kit picker — lite kits only. */
export const GM_PICKER_DRUM_KITS: readonly GmDrumKit[] = GM_DRUM_KITS.filter((kit) =>
  GM_LITE_DRUM_KITS.includes(kit.program),
);

/** Program name for a GM program number (clamped/guarded). */
export function getGmProgramName(program: number): string {
  return GM_PROGRAM_NAMES[program] ?? `Program ${program}`;
}

/** Drum-kit name for a kit program number (falls back for unlisted kits). */
export function getGmDrumKitName(program: number): string {
  return GM_DRUM_KITS.find((kit) => kit.program === program)?.name ?? `Drum Kit ${program}`;
}

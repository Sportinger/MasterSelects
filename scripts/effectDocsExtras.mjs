// What the generated effect docs (scripts/effectDocsCatalog.mjs) cannot read from the registry:
// rows of an effect's own inspector card, the order and folding of long cards, and "Go deeper"
// links for basic pages. Keys are registry ids. Rules: docs/Features/Documentation-Site.md
// ("Effect pages").
//
//   rows      card rows in card order. A string is a parameter key (also a hidden one the card
//             renders); an object is { key?, label?, range?, default?, section?, before? }:
//             `key` takes the parameter and overrides the given fields, `before` puts the row
//             in front of that parameter's row, otherwise it goes to the end of its section.
//   sections  the card's section order; `open` the sections shown first, the others fold into
//             <details>; `omitSections` and `omit` (keys) are left out (resource ids, internals).
//   sectionLabels  card titles for registry parameter groups ({ 'Time map': 'Time field source' }).
//   note      the controls text when the card shows no fixed rows.
//   deeper    [[text, link relative to docs/Features/effects]] for a basic page's Technical details.
//   thumb     the gallery thumbnail: { region: [left, top, width, height] } as fractions of the source
//             (default: its effect half), { source: <asset path relative to docs/Features> } to cut it from
//             another picture (default: the clip poster when the page plays the effect's loop, else the
//             still), or { shot: <Effect Lab --pairs file> } that renders it.

const LANDMARK_EFFECTS = ['Effect system: landmark tracking effects', '../Effect-System.md#landmark-tracking-effects'];

const SPLIT_THUMB = { shot: 'scripts/effect-lab-shots/color-thumbs.json' };

const cableRow = (section, label, range, defaultValue) => ({ section, label, range, default: defaultValue });

export const EFFECT_DOC_EXTRAS = {
  // Subtle tonal effects: the cards show the dancer split down the middle, original | effect.
  brightness: { thumb: SPLIT_THUMB },
  contrast: { thumb: SPLIT_THUMB },
  exposure: { thumb: SPLIT_THUMB },
  levels: { thumb: SPLIT_THUMB },
  // The whole blurred half at card size hides the blur: the houses and boats, closer.
  'gaussian-blur': { thumb: { region: [0.66, 0.2, 0.3, 0.6] } },
  // Matrix Rain: the dancer's figure in the rain, not the dark stage beside her.
  matrix: { thumb: { region: [0.53, 0.3, 0.36, 0.7] } },
  // Generators: the still is the effect frame alone.
  'color-wheel': { thumb: { region: [0, 0, 1, 1] } },
  'perspective-grid': { thumb: { region: [0, 0, 1, 1] } },
  // Stick Figure: the thumbnail is cut from the still, the default figure walking alone on black (the
  // loop's poster catches it mid-jump at the right edge); below its parameters the card has the
  // Pose library, Motion and Actions sections of its own (StickFigureControls, StickFigureActionLane).
  'stick-figure': {
    thumb: { source: 'assets/effects/stick-figure.webp', region: [0.2, 0.14, 0.6, 0.72] },
    sections: ['Pose', 'Proportions', 'Ground', 'Style', 'Pose library', 'Motion', 'Actions'],
    rows: [
      cableRow('Pose library', 'Pose', '13 built-in poses and the poses you saved', 'Stand'),
      cableRow('Pose library', 'Use', 'Apply or Key pose', 'none'),
      cableRow('Pose library', 'Key easing', 'Ease in-out, Linear, Ease in, Ease out', 'Ease in-out'),
      cableRow('Pose library', 'Save', 'A name and Save pose', 'empty'),
      cableRow('Motion', 'Gait', 'Walk, Run or Idle', 'none'),
      cableRow('Actions', 'Action lane', 'One block per action along the clip', 'empty'),
      cableRow('Actions', 'Add', 'Idle, Walk, Run, Jump, Punch, Kick, Duck, Hit React, Throw, Grab, Land or Fall, then At playhead', 'Punch'),
      cableRow('Actions', 'Start', '0 s to the clip length', 'the playhead'),
      cableRow('Actions', 'Duration', '0.05 to 10 s', 'the action’s own length'),
      cableRow('Actions', 'Strength', '0 to 2', '1'),
      cableRow('Actions', 'Aim at', 'A joint of another Stick Figure, or No target', 'No target'),
      cableRow('Actions', 'Contacts', 'Markers', 'none'),
      cableRow('Actions', 'Sound', 'One of the SFX sounds, then Sounds', 'Hit'),
      cableRow('Actions', 'Check', 'Check choreography', 'none'),
    ],
  },
  // Weave: the loop's poster is the finished net alone on black; Form and Color sit above the card's sections.
  weave: { thumb: { region: [0, 0, 1, 1] }, sectionLabels: { '': 'Form and color' } },
  // A current Sharpen's card has only these rows: its own control (a note with Use the new Sharpen)
  // shows on Sharpens saved with 3.2.7 alone, and the page's Saved projects note describes it.
  sharpen: { rows: ['amount', 'radius'] },
  // The still is a detail at twice the size: the card shows the dithered face and raised arm.
  dither: { thumb: { region: [0.6, 0.06, 0.34, 0.38] } },
  // Chroma Key's own card: four sections, View under Screen, short labels inside Edge and Spill.
  'chroma-key': {
    sections: ['Key', 'Matte', 'Edge', 'Spill'],
    rows: [
      { key: 'keyColor', section: 'Key' }, { key: 'screenColor', section: 'Key' }, { key: 'view', section: 'Key' },
      { key: 'clipBlack', section: 'Matte' }, { key: 'clipWhite', section: 'Matte' },
      { key: 'edgeShrink', section: 'Edge' }, { key: 'edgeSoftness', section: 'Edge', label: 'Softness' },
      { key: 'spillSuppression', section: 'Spill', label: 'Suppression' }, { key: 'spillMethod', section: 'Spill', label: 'Method' },
    ],
  },
  'ai-edge-fill': {
    rows: [
      'resolution',
      { key: 'prompt', default: 'a description of the scene to continue (editable)' },
      { label: 'Generate fill', range: 'button', default: '–' },
      'mix',
      'seamBlend',
    ],
  },
  'face-cables': {
    sections: ['Connections', 'Shared wind & face collision', 'Light & face shadows', 'Physics', 'Wind', 'Appearance', 'Bake'],
    rows: [
      cableRow('Connections', 'Cable', '1 to 32 cables (Add cable, Branch, Remove cable)', '1 cable'),
      cableRow('Connections', 'From', 'a face landmark or another cable’s midpoint', 'Right mouth corner'),
      cableRow('Connections', 'To', 'a face landmark', 'Right iris / pupil center'),
      cableRow('Connections', 'Attachment: Lock start, Lock end', 'on or off', 'on'),
      cableRow('Physics', 'Segments', '4 to 96', '24'),
      cableRow('Physics', 'Length factor', '1.05 to 3', '1.6'),
      cableRow('Physics', 'Stiffness', '0 to 1', '0'),
      cableRow('Physics', 'Gravity', '0 to 3', '0.6'),
      cableRow('Physics', 'Damping', '0.2 to 10', '2.2'),
      cableRow('Physics', 'Viscosity', '0 to 1', '0'),
      cableRow('Wind', 'Toward camera', '−30 to 30', '0'),
      cableRow('Wind', 'Gusts', '0 to 1', '0'),
      cableRow('Appearance', 'Style', 'Shaded cable, Flat line', 'Shaded cable'),
      cableRow('Appearance', 'Thickness', '1 to 20', '6'),
      cableRow('Appearance', 'Color', 'a colour', '`#ff873d`'),
      cableRow('Appearance', 'Attachments: Show rings', 'on or off', 'on'),
      cableRow('Bake', 'Bake cables · Rebake physics', 'buttons', '–'),
      ...['sharedWind', 'globalWindStrength', 'globalWindYaw', 'globalWindPitch', 'globalWindGusts', 'faceCollision']
        .map((key) => ({ key, section: 'Shared wind & face collision' })),
      ...['sceneDepth', 'sceneDepthStrength', 'faceShadows', 'lightHorizontal', 'lightVertical', 'shadowStrength', 'shadowSoftness']
        .map((key) => ({ key, section: 'Light & face shadows' })),
    ],
  },
  // The card of the default swarm (Free Swarm): its rows come from the swarm graph (clip.flock), not
  // from effect parameters, and other presets expose other rows (FLOCKING_CARD_PRESET_IDS).
  flocking: {
    thumb: { region: [0, 0, 1, 1] },
    sections: ['Population', 'Behavior', 'Appearance', 'More controls', 'Time & Quality'],
    rows: [
      cableRow('Population', 'Population', '1 to 4 194 304', '4000'),
      cableRow('Behavior', 'Cohesion', '0 to 10', '1'),
      cableRow('Behavior', 'Separation', '0 to 10', '1.6'),
      cableRow('Behavior', 'Alignment', '0 to 10', '1.2'),
      cableRow('Behavior', 'Speed', '0 to 4', '1'),
      cableRow('Behavior', 'Turbulence', '0 and up', '18'),
      cableRow('Appearance', 'Size', '0 to 200 px', '6 px'),
      cableRow('Appearance', 'Color', 'a colour', '`#b4e2ff`'),
      cableRow('More controls', 'Add', 'any value of the swarm graph', 'none'),
      cableRow('Time & Quality', 'Step rate', '30, 60 or 120 Hz', '60 Hz'),
      cableRow('Time & Quality', 'Warm-up', '0 to 30 s', '0 s'),
      cableRow('Time & Quality', 'Loop', 'Continuous, Reset each loop', 'Continuous'),
    ],
  },
  'time-stack': {
    rows: ['count', { key: 'offset', label: 'Time offset', range: '0 to 10 s', default: '0.1 s' }, 'decay', 'blendMode', 'previewSize', 'memoryMiB'],
  },
  'slit-scan': {
    sections: ['Time', 'Wave', 'Sampling', 'Motion compensation', 'Preview quality', '3D geometry', 'Space-time slice', 'Stabilization',
      'Time map', 'Shape target', 'Motion field', 'Field shaping', 'Field noise', 'Field combination', 'RGB time', 'Protection mask',
      'Subject protection', 'Protected center'],
    open: ['Time', 'Wave'],
    sectionLabels: { Stabilization: 'Object stabilization', 'Time map': 'Time field source' },
    omitSections: ['Resources'],
    omit: ['temporalMode', 'temporalResolution'],
    rows: [
      { section: 'Time', before: 'angle', label: 'Scan direction', range: 'Left → right, Top → bottom, Bottom → top, Right → left', default: 'Left → right' },
      { section: 'Motion compensation', before: 'temporalMotionStrength', label: 'Motion compensation (section switch)', range: 'off or DIS optical flow', default: 'off' },
      { section: 'Preview quality', before: 'temporalPreview', label: 'Quality', range: 'Small preview · 160 px, Full size', default: 'Full size' },
      { section: 'Protection mask', label: 'Clip mask', range: 'None or a mask of the clip', default: 'None' },
      { section: 'Protection mask', label: 'Mask feather', range: '0 to 200 px', default: '30 px' },
    ],
  },
  'splat-exploration': { deeper: [['3D Layers: Splat Exploration nodes', '../3D-Layers.md#splat-exploration-nodes']] },
  'hand-particles': { deeper: [LANDMARK_EFFECTS] },
  'hud-tracker': { deeper: [LANDMARK_EFFECTS] },
  cctv: { deeper: [LANDMARK_EFFECTS] },
  subject: { deeper: [LANDMARK_EFFECTS] },
  'tracked-scene': { deeper: [LANDMARK_EFFECTS] },
  stardust: { deeper: [LANDMARK_EFFECTS] },
  'rain-reveal': { deeper: [LANDMARK_EFFECTS] },
  // History Loop has no section, so the card shows it right under the Preset row.
  'kinetic-trace': { rows: ['historyLoop', 'trail', 'softness', 'tint', 'color', 'amount'], deeper: [LANDMARK_EFFECTS] },
};

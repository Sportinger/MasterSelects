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
//   thumb     the gallery thumbnail: { region: [left, top, width, height] } as fractions of the still
//             (default: its effect half), or { shot: <Effect Lab --pairs file> } that renders it.

const LANDMARK_EFFECTS = ['Effect system: landmark tracking effects', '../Effect-System.md#landmark-tracking-effects'];

const SPLIT_THUMB = { shot: 'scripts/effect-lab-shots/color-thumbs.json' };

const cableRow = (section, label, range, defaultValue) => ({ section, label, range, default: defaultValue });

export const EFFECT_DOC_EXTRAS = {
  // Subtle tonal effects: the cards show the dancer split down the middle, original | effect.
  brightness: { thumb: SPLIT_THUMB },
  contrast: { thumb: SPLIT_THUMB },
  exposure: { thumb: SPLIT_THUMB },
  levels: { thumb: SPLIT_THUMB },
  // The still has three panels (original, Saturation, Vibrance): the card shows the last.
  vibrance: { thumb: { region: [0.67, 0, 0.33, 1] } },
  // Generators: the still is the effect frame alone.
  'color-wheel': { thumb: { region: [0, 0, 1, 1] } },
  'perspective-grid': { thumb: { region: [0, 0, 1, 1] } },
  'stick-figure': { thumb: { region: [0, 0, 1, 1] } },
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
  flocking: {
    note: 'The card shows a **Preset** menu and the values that preset exposes, grouped as Population, Behavior, Guidance, Appearance and Lines; they change with the preset. **Open Nodes** shows the whole swarm graph.',
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
      { section: 'Time', before: 'preview', label: 'Look', range: 'Sweep, Falling time, Center out, Wave folds, Radial bloom, Time rings, Time steps', default: 'Sweep' },
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
  'kinetic-trace': { deeper: [LANDMARK_EFFECTS] },
};

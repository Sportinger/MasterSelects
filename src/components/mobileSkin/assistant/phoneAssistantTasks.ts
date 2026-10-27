// Every phone catalog item whose phone home is the assistant (phone_tier 'assistant', PLAN M5),
// written as one task in plain words. All tools lists each as "Ask the assistant: <task>"; a tap
// opens the assistant with `prompt` typed into the field, not sent, so the person can adjust it.
// The catalog ids are the ones of the phone plan (katalog-INV-*.md), so the gap list stays checkable.
// Left out on purpose: INV-8/developer-bridge-test-command-accounting (a developer-only bookkeeping
// item with no button by its own definition).

export interface PhoneAssistantTask {
  /** Phone catalog id, 'INV-n/<item>'. */
  catalogId: string;
  /** The task in plain words, after "Ask the assistant: ". */
  task: string;
  /** Typed into the assistant's field. */
  prompt: string;
  /** Extra words the All tools search matches (lower case). */
  keywords: string;
}

export const PHONE_ASSISTANT_TASKS: readonly PhoneAssistantTask[] = [
  { catalogId: 'INV-8/assistant-chat', task: 'edit my video for me', keywords: 'chat ai help flashboard',
    prompt: 'Look at my timeline and suggest three edits that would make this video better, then make the first one.' },
  { catalogId: 'INV-1/assistant-timeline-editing', task: 'check and tidy the timeline', keywords: 'gaps overlaps cleanup',
    prompt: 'Check the timeline for gaps, overlaps and very short clips and fix what you find.' },
  { catalogId: 'INV-8/assistant-timeline-inspection', task: 'describe what is on the timeline', keywords: 'inspect summary selection clips',
    prompt: 'Describe what is on the timeline right now: tracks, clips, lengths and what is selected.' },
  { catalogId: 'INV-8/assistant-clip-editing', task: 'cut and reorder clips', keywords: 'split trim move order',
    prompt: 'Trim the selected clip so it starts at its first strong moment, and move it to the start of the timeline.' },
  { catalogId: 'INV-1/bulk-split-and-range-removal', task: 'split into parts or remove ranges', keywords: 'bulk split many cuts range delete',
    prompt: 'Split the selected clip into 4 equal parts.' },
  { catalogId: 'INV-8/silence-and-speech-cleanup', task: 'remove pauses and filler words', keywords: 'silence speech um uh cleanup',
    prompt: 'Remove the long pauses and filler words from the speech in the selected clip.' },
  { catalogId: 'INV-8/assistant-track-management', task: 'add, rename or reorder tracks', keywords: 'tracks layers lanes',
    prompt: 'Add a new video track above the others and name it "Titles".' },
  { catalogId: 'INV-8/assistant-playback-and-markers', task: 'set markers and playback speed', keywords: 'markers speed tempo playhead',
    prompt: 'Put a marker at every cut on the timeline and name them Shot 1, Shot 2 and so on.' },
  { catalogId: 'INV-8/assistant-beat-rules', task: 'cut the clips to the beat', keywords: 'beat music rhythm sync',
    prompt: 'Cut the video clips to the beat of the music track, one cut every second beat.' },
  { catalogId: 'INV-8/assistant-audio-sync-multicam', task: 'sync audio and build a multicam', keywords: 'multicam angles sync waveform',
    prompt: 'Sync the selected clips by their audio and make a multicam clip from them.' },
  { catalogId: 'INV-4/audio-assistant-editing', task: 'fix the sound', keywords: 'audio voice loudness music duck',
    prompt: 'Make the voice clear and even in loudness, and lower the music while someone speaks.' },
  { catalogId: 'INV-8/assistant-compositions', task: 'create or nest compositions', keywords: 'composition nest precompose',
    prompt: 'Put the selected clips into a new nested composition called "Intro".' },
  { catalogId: 'INV-6/assistant-media-organization', task: 'sort media and compositions', keywords: 'organize folders bins',
    prompt: 'Sort my media into folders for video, audio and images, and give the compositions clear names.' },
  { catalogId: 'INV-8/assistant-media-library', task: 'rename and tidy project media', keywords: 'media library rename unused',
    prompt: 'Rename the media files by what they show and list the ones not used on the timeline.' },
  { catalogId: 'INV-8/assistant-effects-and-transform', task: 'change effects and position', keywords: 'effects transform scale position',
    prompt: 'Add a soft blur to the selected clip and scale it to 110 percent.' },
  { catalogId: 'INV-2/assistant-effects-and-graphs', task: 'build or change an effect graph', keywords: 'effects graph nodes stack',
    prompt: 'Give the selected clip a warm film look with grain and a light vignette.' },
  { catalogId: 'INV-8/assistant-node-authoring', task: 'make an editable node graph', keywords: 'nodes graph author',
    prompt: 'Build an editable node graph on the selected clip that tints the shadows blue and the highlights orange.' },
  { catalogId: 'INV-2/custom-ai-nodes', task: 'create a custom AI node', keywords: 'ai node custom generate',
    prompt: 'Create a custom node for the selected clip that slowly pulses its brightness with the music.' },
  { catalogId: 'INV-3/assistant-transform-mask-animation', task: 'animate position, mask or scale', keywords: 'animate motion mask transform',
    prompt: 'Animate the selected clip so it slowly zooms in over its whole length.' },
  { catalogId: 'INV-8/assistant-keyframes', task: 'set or ease keyframes', keywords: 'keyframes animation ease curve',
    prompt: 'Add keyframes that fade the selected clip in over the first second, with an ease-out curve.' },
  { catalogId: 'INV-8/assistant-masks', task: 'draw or animate a mask', keywords: 'mask shape path feather',
    prompt: 'Add a soft round mask around the centre of the selected clip with a wide feather.' },
  { catalogId: 'INV-8/assistant-transitions', task: 'add or remove transitions', keywords: 'transitions cross dissolve fade',
    prompt: 'Put a short cross dissolve between every two clips on the main track.' },
  { catalogId: 'INV-8/assistant-text-and-hooks', task: 'make a title or animated text', keywords: 'text title hook lower third',
    prompt: 'Add a bold animated title "Summer 2026" at the start that stays for three seconds.' },
  { catalogId: 'INV-5/editable-title-stack', task: 'make a lower third or title stack', keywords: 'lower third name title stack',
    prompt: 'Add an editable lower third with a name and a role line at the playhead.' },
  { catalogId: 'INV-8/assistant-motion-shapes', task: 'create shapes and motion templates', keywords: 'shapes motion design template',
    prompt: 'Create a simple animated shape intro: a circle that grows and reveals the first clip.' },
  { catalogId: 'INV-8/assistant-motion-relationships', task: 'link motion with parents and repeats', keywords: 'parent null repeater relationship',
    prompt: 'Make the title follow the movement of the selected clip, as if parented to it.' },
  { catalogId: 'INV-8/assistant-generated-clips', task: 'add colour, empty or MIDI clips', keywords: 'solid colour empty midi generate',
    prompt: 'Add a black colour clip of two seconds at the end of the timeline.' },
  { catalogId: 'INV-8/assistant-flock', task: 'create a particle swarm', keywords: 'flock particles swarm boids',
    prompt: 'Add a swarm of small particles that flies across the picture over the selected clip.' },
  { catalogId: 'INV-8/assistant-stick-figure-rigs', task: 'animate a stick figure', keywords: 'stick figure rig character action',
    prompt: 'Add a stick figure that walks in from the left and waves.' },
  { catalogId: 'INV-8/assistant-scene-streams', task: 'build a named scene and change it', keywords: 'scene stream rebuild',
    prompt: 'Build a short scene called "Opening" with a title and two clips, so we can change it later.' },
  { catalogId: 'INV-8/assistant-visual-review', task: 'review the picture and the cuts', keywords: 'review frames compare quality',
    prompt: 'Look at the frames around every cut and tell me which cuts feel rough.' },
  { catalogId: 'INV-8/assistant-progress-and-audit', task: 'show what the last request changed', keywords: 'audit progress log changes',
    prompt: 'List every change your last request made, with the clips it touched.' },
  { catalogId: 'INV-8/assistant-request-undo', task: 'take back the last request', keywords: 'undo request revert',
    prompt: 'Undo everything your last request changed, but keep my own edits since then.' },
  { catalogId: 'INV-8/assistant-plan-and-policy', task: 'plan first, then carry out', keywords: 'plan approve policy',
    prompt: 'Plan how to cut this into a 30 second trailer, show me the plan, and wait for my OK before changing anything.' },
  { catalogId: 'INV-8/assistant-project-documents', task: 'write notes or a script', keywords: 'notes notebook script document',
    prompt: 'Write a short shot list for this project into the notebook.' },
  { catalogId: 'INV-8/story-production-workflow', task: 'plan a story from my material', keywords: 'story workflow production',
    prompt: 'Turn my imported material into a short story with a beginning, a middle and an end.' },
  { catalogId: 'INV-1/storyboard-decisions', task: 'decide storyboard options with me', keywords: 'storyboard decisions options',
    prompt: 'Give me three storyboard options for the opening and let me choose.' },
  { catalogId: 'INV-8/assistant-storyboard-scenes', task: 'write storyboard scene cards', keywords: 'storyboard scenes cards',
    prompt: 'Write a storyboard scene card for every part of the timeline.' },
];

export function getPhoneAssistantTask(catalogId: string): PhoneAssistantTask | undefined {
  return PHONE_ASSISTANT_TASKS.find((task) => task.catalogId === catalogId);
}

import type { StoryboardTemplate, StoryboardTemplateBeat } from '../contracts';
import type { StoryboardTemplateCatalogEntry } from './types';

function visualBeat(
  id: string,
  title: string,
  purpose: string,
  targetShare: number,
  defaultSceneKind: string,
  evidenceExpectations: string[],
  prompt: string,
): StoryboardTemplateBeat {
  return {
    id,
    title,
    purpose,
    targetShare,
    defaultSceneKind,
    evidenceExpectations,
    generationDefaults: {
      prompt,
      referenceMediaFileIds: [],
      capabilityPolicy: {
        mediaType: 'video',
        preferredQuality: 'balanced',
      },
    },
  };
}

const BUILT_IN_TEMPLATES: readonly StoryboardTemplate[] = [
  {
    schemaVersion: 1,
    id: 'builtin-youtube-essay',
    name: 'YouTube essay',
    version: 1,
    description: 'A thesis-led long-form video essay with a strong hook and chaptered argument.',
    targetDurationSeconds: 300,
    aspectRatio: '16:9',
    beats: [
      visualBeat('hook', 'Hook', 'Open on the central tension or most surprising claim.', 0.05, 'hook', ['A compelling quote, claim, or visual contradiction'], 'A concise cinematic hook that introduces the central tension.'),
      visualBeat('context', 'Context', 'Give the audience the minimum context needed to follow the argument.', 0.15, 'context', ['Primary-source context', 'Establishing visuals'], 'Clear contextual visuals that establish time, place, and subject.'),
      visualBeat('thesis', 'Thesis', 'State the essay thesis and viewing promise.', 0.1, 'thesis', ['A direct thesis statement'], 'A confident thesis beat with a clean visual metaphor.'),
      visualBeat('argument', 'Main argument', 'Develop the evidence and counterpoints in structured chapters.', 0.55, 'chapter', ['Multiple source moments', 'B-roll or explanatory graphics'], 'Editorial b-roll and explanatory visuals supporting the main argument.'),
      visualBeat('conclusion', 'Conclusion', 'Resolve the thesis and synthesize the evidence.', 0.1, 'conclusion', ['A supported takeaway'], 'A reflective conclusion that visually resolves the opening tension.'),
      visualBeat('cta', 'Call to action', 'Close with a relevant next step for the audience.', 0.05, 'cta', ['Closing title or spoken action'], 'A restrained closing title and call-to-action beat.'),
    ],
  },
  {
    schemaVersion: 1,
    id: 'builtin-talking-head-broll',
    name: 'Talking head + b-roll',
    version: 1,
    description: 'A presenter-led structure balanced with purposeful b-roll coverage.',
    targetDurationSeconds: 180,
    aspectRatio: '16:9',
    beats: [
      visualBeat('hook', 'Presenter hook', 'Open with the strongest presenter line.', 0.08, 'talking-head', ['Current transcript moment', 'Presenter source range'], 'A direct-to-camera presenter hook with immediate energy.'),
      visualBeat('promise', 'Viewing promise', 'Explain what the audience will learn or gain.', 0.12, 'talking-head', ['Clear spoken promise'], 'A clean presenter beat that states the viewing promise.'),
      visualBeat('explanation', 'Core explanation', 'Deliver the main explanation in a coherent presenter section.', 0.35, 'talking-head', ['Multiple transcript moments'], 'Natural presenter coverage with subtle editorial variation.'),
      visualBeat('broll', 'B-roll proof', 'Show visual evidence for the presenter claims.', 0.25, 'b-roll', ['At least one source range or approved visual candidate'], 'Specific illustrative b-roll that proves the presenter claim.'),
      visualBeat('takeaway', 'Takeaway', 'Condense the idea into one memorable conclusion.', 0.15, 'talking-head', ['Closing transcript moment'], 'A composed presenter takeaway with visual closure.'),
      visualBeat('cta', 'Call to action', 'Offer the next relevant audience action.', 0.05, 'cta', ['Spoken or visual call to action'], 'A concise call-to-action closing beat.'),
    ],
  },
  {
    schemaVersion: 1,
    id: 'builtin-trailer-teaser',
    name: 'Trailer / teaser',
    version: 1,
    description: 'A compressed escalation from cold open to title reveal and final tag.',
    targetDurationSeconds: 60,
    aspectRatio: '16:9',
    beats: [
      visualBeat('cold-open', 'Cold open', 'Start with an arresting image or line before explanation.', 0.12, 'hook', ['High-impact source moment'], 'A striking cold-open image with immediate dramatic tension.'),
      visualBeat('setup', 'Setup', 'Introduce the world, characters, or central question.', 0.18, 'setup', ['Character or location evidence'], 'Fast, legible setup shots introducing world and stakes.'),
      visualBeat('escalation', 'Escalation', 'Increase pace, stakes, and visual scale.', 0.25, 'montage', ['Several escalating source moments', 'Rising audio energy'], 'An escalating montage with increasing pace and scale.'),
      visualBeat('climax', 'Audio-visual climax', 'Deliver the peak emotional and rhythmic moment.', 0.25, 'climax', ['Audio climax', 'Accepted hero image or source moment'], 'A high-impact audiovisual climax built around the hero moment.'),
      visualBeat('title', 'Title reveal', 'Land the title, product, or release information clearly.', 0.12, 'title', ['Closing title or product mark'], 'A bold, legible title reveal with clean negative space.'),
      visualBeat('tag', 'Final tag', 'End on one memorable sting, joke, or unresolved beat.', 0.08, 'tag', ['Final source moment or audio sting'], 'A memorable final tag with a sharp ending.'),
    ],
  },
  {
    schemaVersion: 1,
    id: 'builtin-short-vertical-social',
    name: 'Short vertical social video',
    version: 1,
    description: 'A fast vertical structure optimized for an immediate hook and single payoff.',
    targetDurationSeconds: 30,
    aspectRatio: '9:16',
    beats: [
      visualBeat('hook', 'First-second hook', 'Create immediate curiosity before the viewer scrolls.', 0.15, 'hook', ['Immediate visual or spoken hook'], 'A bold vertical hook readable in the first second.'),
      visualBeat('value', 'Core value', 'Deliver one focused idea, demonstration, or story.', 0.55, 'vertical-main', ['Primary proof or demonstration'], 'Fast vertical coverage focused on one clear idea.'),
      visualBeat('payoff', 'Payoff', 'Resolve the question or show the result.', 0.2, 'payoff', ['Clear result or reveal'], 'A satisfying vertical payoff with a clear before-and-after read.'),
      visualBeat('cta', 'Call to action', 'Close with one concise action or loop-back.', 0.1, 'cta', ['Closing title or spoken action'], 'A compact vertical call-to-action or seamless loop ending.'),
    ],
  },
  {
    schemaVersion: 1,
    id: 'builtin-product-demo',
    name: 'Product demo',
    version: 1,
    description: 'A problem-to-proof product story with a concrete guided walkthrough.',
    targetDurationSeconds: 120,
    aspectRatio: '16:9',
    beats: [
      visualBeat('problem', 'Problem', 'Make the user problem recognizable and concrete.', 0.1, 'problem', ['User pain evidence'], 'A concrete depiction of the user problem and its friction.'),
      visualBeat('promise', 'Product promise', 'State the outcome the product enables.', 0.12, 'promise', ['Product or presenter claim'], 'A clear product promise centered on the user outcome.'),
      visualBeat('walkthrough', 'Walkthrough', 'Demonstrate the core workflow step by step.', 0.38, 'demo', ['Product capture or feature source ranges'], 'A legible product walkthrough emphasizing the core workflow.'),
      visualBeat('proof', 'Proof', 'Show the result, evidence, or customer impact.', 0.2, 'proof', ['Result capture, metric, or testimonial'], 'Credible proof of the product result with restrained graphics.'),
      visualBeat('recap', 'Recap', 'Summarize the differentiators and outcome.', 0.12, 'recap', ['Supported takeaway'], 'A concise visual recap of the strongest differentiators.'),
      visualBeat('cta', 'Next step', 'Give the viewer one clear next action.', 0.08, 'cta', ['Closing action or URL'], 'A clean product closing frame with one clear next step.'),
    ],
  },
  {
    schemaVersion: 1,
    id: 'builtin-interview-portrait',
    name: 'Interview portrait',
    version: 1,
    description: 'A character-led portrait moving from introduction through depth and reflection.',
    targetDurationSeconds: 300,
    aspectRatio: '16:9',
    beats: [
      visualBeat('introduction', 'Introduction', 'Establish the subject in their environment.', 0.08, 'portrait-intro', ['Subject image', 'Identity or context quote'], 'An intimate environmental portrait introducing the subject.'),
      visualBeat('origin', 'Origin', 'Reveal the formative history behind the subject.', 0.32, 'interview', ['Current transcript moments', 'Archive or contextual b-roll'], 'Interview and contextual b-roll illustrating the subject origin.'),
      visualBeat('depth', 'Conflict and depth', 'Explore the central challenge, craft, or contradiction.', 0.35, 'interview-depth', ['Multiple supporting transcript moments', 'Observational source ranges'], 'Observational portrait coverage revealing conflict and craft.'),
      visualBeat('reflection', 'Reflection', 'Let the subject articulate meaning or change.', 0.17, 'reflection', ['Reflective transcript moment'], 'A quiet reflective portrait beat with emotional space.'),
      visualBeat('closing', 'Closing image', 'End on an image or line that continues beyond the film.', 0.08, 'portrait-close', ['Closing quote or environmental image'], 'A resonant closing portrait image that lingers after the final line.'),
    ],
  },
] as const;

export const BUILT_IN_STORYBOARD_TEMPLATE_IDS = BUILT_IN_TEMPLATES
  .map(template => template.id);

export function isBuiltInStoryboardTemplateId(id: string): boolean {
  return BUILT_IN_STORYBOARD_TEMPLATE_IDS.includes(id);
}

export function getBuiltInStoryboardTemplates(): StoryboardTemplate[] {
  return BUILT_IN_TEMPLATES.map(template => structuredClone(template));
}

export function getBuiltInStoryboardTemplate(id: string): StoryboardTemplate | undefined {
  const template = BUILT_IN_TEMPLATES.find(candidate => candidate.id === id);
  return template ? structuredClone(template) : undefined;
}

export function createStoryboardTemplateCatalog(
  customTemplates: Readonly<Record<string, StoryboardTemplate>>,
): StoryboardTemplateCatalogEntry[] {
  for (const id of Object.keys(customTemplates)) {
    if (isBuiltInStoryboardTemplateId(id)) {
      throw new Error(`Custom template ${id} collides with an immutable built-in template.`);
    }
  }
  return [
    ...getBuiltInStoryboardTemplates().map(template => ({
      origin: 'built-in' as const,
      template,
    })),
    ...Object.values(customTemplates)
      .toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(template => ({
        origin: 'custom' as const,
        template: structuredClone(template),
      })),
  ];
}

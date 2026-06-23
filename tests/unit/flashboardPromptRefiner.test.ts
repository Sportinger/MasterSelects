import { describe, expect, it } from 'vitest';

import {
  FLASHBOARD_PROMPT_REFINER_MODEL,
  buildFlashBoardPromptRefinerInstructions,
  buildFlashBoardPromptRefinerStreamingUserText,
  buildFlashBoardPromptRefinerUserText,
  extractRefinedPromptFromOpenAIResponse,
  parseOpenAIStreamFrame,
  parseSunoPromptRefinement,
} from '../../src/services/flashboard/FlashBoardPromptRefiner';
import type { CatalogEntry } from '../../src/services/flashboard/types';

const nanoBananaEntry: CatalogEntry = {
  service: 'kieai',
  providerId: 'nano-banana-2',
  name: 'Nano Banana 2',
  description: 'Image generation with references',
  versions: ['3.1'],
  modes: [],
  durations: [],
  aspectRatios: ['16:9'],
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsTextToImage: true,
  supportsGenerateAudio: false,
  supportsMultiShot: false,
  imageSizes: ['1K'],
  maxReferenceImages: 14,
  maxReferenceMedia: 14,
  outputType: 'image',
};

const klingEntry: CatalogEntry = {
  service: 'kieai',
  providerId: 'kling-3.0',
  name: 'Kling 3.0',
  description: 'Video generation',
  versions: ['latest'],
  modes: ['std'],
  durations: [5],
  aspectRatios: ['16:9'],
  supportsTextToVideo: true,
  supportsImageToVideo: true,
  supportsGenerateAudio: true,
  supportsMultiShot: true,
  maxReferenceMedia: 3,
  outputType: 'video',
};

const seedanceEntry: CatalogEntry = {
  service: 'cloud',
  providerId: 'bytedance/seedance-2',
  name: 'Seedance 2.0',
  description: 'Hosted Seedance video generation',
  versions: ['latest'],
  modes: ['480p', '720p', '1080p'],
  durations: [4, 5, 10],
  aspectRatios: ['16:9'],
  supportsTextToVideo: true,
  supportsImageToVideo: true,
  supportsGenerateAudio: true,
  supportsMultiShot: false,
  maxReferenceMedia: 8,
  outputType: 'video',
};

const gptImageEditEntry: CatalogEntry = {
  service: 'kieai',
  providerId: 'gpt-image-2-image-to-image',
  name: 'GPT Image 2 Edit',
  description: 'Image editing',
  versions: ['latest'],
  modes: [],
  durations: [],
  aspectRatios: ['auto'],
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsTextToImage: true,
  supportsGenerateAudio: false,
  supportsMultiShot: false,
  maxReferenceMedia: 16,
  outputType: 'image',
  promptRefinerProfile: 'gpt-image-edit',
  requiresReferenceMedia: true,
};

const sunoEntry: CatalogEntry = {
  service: 'suno',
  providerId: 'suno-music',
  name: 'Suno Music',
  description: 'Music generation',
  versions: ['V5'],
  modes: [],
  durations: [],
  aspectRatios: [],
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsTextToAudio: true,
  outputType: 'audio',
};

const sunoSoundsEntry: CatalogEntry = {
  service: 'suno',
  providerId: 'suno-sounds',
  name: 'Suno Sounds',
  description: 'Sound generation',
  versions: ['V5'],
  modes: ['one-shot', 'loop'],
  durations: [],
  aspectRatios: [],
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsTextToAudio: true,
  outputType: 'audio',
  promptRefinerProfile: 'suno-sounds',
};

const topazImageEntry: CatalogEntry = {
  service: 'kieai',
  providerId: 'topaz/image-upscale',
  name: 'Topaz Image Upscale',
  description: 'Image utility',
  versions: ['latest'],
  modes: [],
  durations: [],
  aspectRatios: [],
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsTextToImage: true,
  supportsGenerateAudio: false,
  supportsMultiShot: false,
  outputType: 'image',
  promptRefinerProfile: 'utility-image',
  requiresPrompt: false,
  requiresReferenceMedia: true,
  requiredReferenceMediaType: 'image',
};

describe('FlashBoardPromptRefiner', () => {
  it('uses GPT-5.5 as the prompt refiner model', () => {
    expect(FLASHBOARD_PROMPT_REFINER_MODEL).toBe('gpt-5.5');
  });

  it('builds image-model guidance for Nano Banana reference prompts', () => {
    const instructions = buildFlashBoardPromptRefinerInstructions({
      entry: nanoBananaEntry,
      service: nanoBananaEntry.service,
      providerId: nanoBananaEntry.providerId,
      version: '3.1',
      generateAudio: false,
      multiShots: false,
    });

    expect(instructions).toContain('Nano Banana 2');
    expect(instructions).toContain('single still-image generation prompt');
    expect(instructions).toContain('reference-aware');
    expect(instructions).toContain('REF labels');
  });

  it('builds edit-model guidance for GPT Image 2 image-to-image', () => {
    const instructions = buildFlashBoardPromptRefinerInstructions({
      entry: gptImageEditEntry,
      service: gptImageEditEntry.service,
      providerId: gptImageEditEntry.providerId,
      version: 'latest',
      generateAudio: false,
      multiShots: false,
    });

    expect(instructions).toContain('GPT Image editing');
    expect(instructions).toContain('preserve list');
    expect(instructions).toContain('reference-image roles');
  });

  it('builds video-model guidance for Kling with sound and multishot context', () => {
    const instructions = buildFlashBoardPromptRefinerInstructions({
      entry: klingEntry,
      service: klingEntry.service,
      providerId: klingEntry.providerId,
      version: 'latest',
      generateAudio: true,
      multiShots: true,
    });

    expect(instructions).toContain('Kling-style');
    expect(instructions).toContain('Multi-shot is enabled');
    expect(instructions).toContain('Sound generation is enabled');
  });

  it('builds Seedance 2 prompt guidance around multimodal and audio-driven references', () => {
    const instructions = buildFlashBoardPromptRefinerInstructions({
      entry: seedanceEntry,
      service: seedanceEntry.service,
      providerId: seedanceEntry.providerId,
      version: 'latest',
      generateAudio: true,
      multiShots: false,
    });
    const userText = buildFlashBoardPromptRefinerUserText({
      prompt: 'make her speak naturally to the beat',
      entry: seedanceEntry,
      service: seedanceEntry.service,
      providerId: seedanceEntry.providerId,
      mode: '720p',
      duration: 8,
      aspectRatio: '16:9',
      imageSize: '2K',
      generateAudio: true,
      multiShots: false,
    }, [
      { role: 'reference', label: 'REF 1', displayName: 'voice-drive.wav', mediaType: 'audio' },
      { role: 'reference', label: 'REF 2', displayName: 'gesture.mp4', mediaType: 'video' },
    ]);

    expect(instructions).toContain('ByteDance Seedance 2.0');
    expect(instructions).toContain('REF audio');
    expect(instructions).toContain('performance, speech, mouth-shape');
    expect(instructions).toContain('multimodal reference mode');
    expect(userText).toContain('REF 1 (reference audio): voice-drive.wav');
    expect(userText).toContain('REF 2 (reference video): gesture.mp4');
  });

  it('includes selected generation settings and reference labels in user text', () => {
    const userText = buildFlashBoardPromptRefinerUserText({
      prompt: 'mach es dramatischer',
      entry: nanoBananaEntry,
      service: nanoBananaEntry.service,
      providerId: nanoBananaEntry.providerId,
      mode: 'std',
      duration: 5,
      aspectRatio: '16:9',
      imageSize: '2K',
      generateAudio: false,
      multiShots: false,
    }, [
      { role: 'reference', label: 'REF 1', displayName: 'portrait.png' },
    ]);

    expect(userText).toContain('mach es dramatischer');
    expect(userText).toContain('Aspect ratio: 16:9');
    expect(userText).toContain('Image size: 2K');
    expect(userText).toContain('REF 1');
    expect(userText).toContain('portrait.png');
  });

  it('uses plain prompt text instructions for streamed refinements', () => {
    const userText = buildFlashBoardPromptRefinerStreamingUserText({
      prompt: 'mach es dramatischer',
      entry: nanoBananaEntry,
      service: nanoBananaEntry.service,
      providerId: nanoBananaEntry.providerId,
      mode: 'std',
      duration: 5,
      aspectRatio: '16:9',
      imageSize: '2K',
      generateAudio: false,
      multiShots: false,
    }, []);

    expect(userText).toContain('Return the final refined English prompt text only');
    expect(userText).not.toContain('Return JSON');
  });

  it('builds structured Suno guidance for lyrics, style, and negative tags', () => {
    const instructions = buildFlashBoardPromptRefinerInstructions({
      entry: sunoEntry,
      service: sunoEntry.service,
      providerId: sunoEntry.providerId,
      version: 'V5',
      generateAudio: false,
      multiShots: false,
      sunoInstrumental: false,
    });

    expect(instructions).toContain('Suno Prompt Refiner');
    expect(instructions).toContain('LYRICS:');
    expect(instructions).toContain('STYLE:');
    expect(instructions).toContain('NEGATIVE:');
  });

  it('builds sound-design guidance for Suno Sounds without Suno Music sections', () => {
    const instructions = buildFlashBoardPromptRefinerInstructions({
      entry: sunoSoundsEntry,
      service: sunoSoundsEntry.service,
      providerId: sunoSoundsEntry.providerId,
      version: 'V5',
      generateAudio: false,
      multiShots: false,
      sunoInstrumental: true,
    });
    const userText = buildFlashBoardPromptRefinerStreamingUserText({
      prompt: 'short electric door opening loop',
      entry: sunoSoundsEntry,
      service: sunoSoundsEntry.service,
      providerId: sunoSoundsEntry.providerId,
      mode: 'loop',
      duration: 5,
      aspectRatio: '',
      imageSize: '',
      generateAudio: false,
      multiShots: false,
    }, []);

    expect(instructions).toContain('Suno Sounds generation');
    expect(instructions).toContain('sound-design prompt');
    expect(instructions).not.toContain('LYRICS:');
    expect(userText).toContain('Mode: loop');
    expect(userText).toContain('Return the final refined English prompt text only');
  });

  it('builds utility guidance for image upscale prompts', () => {
    const instructions = buildFlashBoardPromptRefinerInstructions({
      entry: topazImageEntry,
      service: topazImageEntry.service,
      providerId: topazImageEntry.providerId,
      version: 'latest',
      generateAudio: false,
      multiShots: false,
    });

    expect(instructions).toContain('image utility operation');
    expect(instructions).toContain('short processing intent');
    expect(instructions).toContain('Preserve the source image content');
  });

  it('includes current Suno fields in streamed refinement text', () => {
    const userText = buildFlashBoardPromptRefinerStreamingUserText({
      prompt: 'song about traffic jam turning into a tree house',
      entry: sunoEntry,
      service: sunoEntry.service,
      providerId: sunoEntry.providerId,
      mode: '',
      duration: 5,
      aspectRatio: '',
      imageSize: '',
      generateAudio: false,
      multiShots: false,
      sunoStyle: 'indie folk, warm male vocal',
      sunoNegativeTags: 'distorted vocals',
      sunoInstrumental: false,
      sunoCustomMode: true,
      sunoVocalGender: 'm',
      sunoStyleWeight: 0.65,
      sunoWeirdnessConstraint: 0.35,
      sunoAudioWeight: 0.65,
    }, []);

    expect(userText).toContain('Current lyrics / song idea');
    expect(userText).toContain('indie folk');
    expect(userText).toContain('Return exactly three labelled sections');
  });

  it('parses labelled Suno prompt refinements', () => {
    expect(parseSunoPromptRefinement([
      'LYRICS:',
      'Verse line',
      'STYLE: alt-pop, soft vocal',
      'NEGATIVE: clipping, harsh noise',
    ].join('\n'))).toEqual({
      lyrics: 'Verse line',
      style: 'alt-pop, soft vocal',
      negativeTags: 'clipping, harsh noise',
    });
  });

  it('parses streamed Responses text delta events', () => {
    expect(parseOpenAIStreamFrame('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"A cinematic"}')).toEqual({
      type: 'response.output_text.delta',
      delta: 'A cinematic',
    });
  });

  it('extracts the refined prompt from output_text JSON', () => {
    expect(extractRefinedPromptFromOpenAIResponse({
      output_text: '{"prompt":"A refined cinematic prompt."}',
    })).toBe('A refined cinematic prompt.');
  });

  it('extracts the refined prompt from Responses output content', () => {
    expect(extractRefinedPromptFromOpenAIResponse({
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: '{"prompt":"A detailed product render prompt."}' },
          ],
        },
      ],
    })).toBe('A detailed product render prompt.');
  });
});

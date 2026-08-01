import { describe, expect, it } from 'vitest';
import type { FlashBoardComposerState } from '../../src/stores/flashboardStore';
import type { MediaFile } from '../../src/stores/mediaStore';
import { buildHostedAgentTurnRequest } from '../../src/services/flashboard/FlashBoardHostedAgentTransport';
import {
  collectFlashBoardChatReferenceImages,
  prepareFlashBoardChatVisualReferences,
} from '../../src/services/flashboard/FlashBoardChatVisualReferences';
import type { FlashBoardChatRequest } from '../../src/services/flashboard/FlashBoardChatTypes';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function request(): FlashBoardChatRequest {
  return {
    model: 'gpt-5-6-terra',
    prompt: 'Compare the attached reference with the current edit.',
    provider: 'kie',
    temperature: 0.7,
    visualReferences: [{
      dataUrl: PNG_DATA_URL,
      id: 'media-reference',
      mediaType: 'image/png',
    }],
  };
}

function composer(): FlashBoardComposerState {
  return {
    endMediaFileId: 'image-b',
    referenceMediaFileIds: ['image-a', 'audio-a', 'image-b'],
    startMediaFileId: 'image-a',
  } as FlashBoardComposerState;
}

function media(id: string, type: MediaFile['type'], file?: File): MediaFile {
  return {
    createdAt: 0,
    file,
    id,
    name: `${id}.png`,
    parentId: null,
    type,
    url: `blob:${id}`,
    width: type === 'image' ? 464 : undefined,
    height: type === 'image' ? 649 : undefined,
  } as MediaFile;
}

describe('FlashBoard initial chat references', () => {
  it('embeds initial images in the exact OpenAI provider input and kernel evidence', () => {
    const turn = buildHostedAgentTurnRequest({
      protocol: 'openai-responses',
      request: request(),
      supportsTools: false,
      systemPrompt: 'System',
    });

    expect(turn.providerInput).toMatchObject({
      input: [{
        role: 'user',
        content: [
          { text: request().prompt, type: 'input_text' },
          { detail: 'high', image_url: PNG_DATA_URL, type: 'input_image' },
        ],
      }],
      protocol: 'openai-responses',
    });
    expect(turn.visualReferences).toEqual([{
      id: 'initial-reference-1',
      mediaType: 'image/png',
      role: 'initial',
      source: PNG_DATA_URL,
      transport: 'data-url',
    }]);
  });

  it('converts the same reference to a Claude base64 image block', () => {
    const turn = buildHostedAgentTurnRequest({
      protocol: 'claude-messages',
      request: { ...request(), model: 'claude-opus-4-8' },
      supportsTools: false,
      systemPrompt: 'System',
    });

    expect(turn.providerInput).toMatchObject({
      messages: [{
        role: 'user',
        content: [
          { text: request().prompt, type: 'text' },
          {
            source: {
              data: 'iVBORw0KGgo=',
              media_type: 'image/png',
              type: 'base64',
            },
            type: 'image',
          },
        ],
      }],
      protocol: 'claude-messages',
    });
    expect(turn.visualReferences[0]?.source).toBe('iVBORw0KGgo=');
  });

  it('collects each attached image once and prepares browser files as data URLs', async () => {
    const files = [
      media('image-a', 'image', new File(['a'], 'a.png', { type: 'image/png' })),
      media('image-b', 'image', new File(['b'], 'b.png', { type: 'image/png' })),
      media('audio-a', 'audio'),
    ];

    expect(collectFlashBoardChatReferenceImages(composer(), files).map((file) => file.id))
      .toEqual(['image-a', 'image-b']);

    const prepared = await prepareFlashBoardChatVisualReferences({
      composer: composer(),
      mediaFiles: files,
    });
    expect(prepared).toHaveLength(2);
    expect(prepared.map((reference) => reference.id)).toEqual(['image-a', 'image-b']);
    expect(prepared[0]).toMatchObject({
      name: 'image-a.png',
      width: 464,
      height: 649,
    });
    expect(prepared.every((reference) => reference.dataUrl.startsWith('data:image/png;base64,')))
      .toBe(true);
  });
});

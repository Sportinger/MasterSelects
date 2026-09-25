import type { DocumentBlock, ProjectDocument } from '../../types/documents';

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const fdxTypes: Record<string, string> = {
  scene: 'Scene Heading', action: 'Action', character: 'Character',
  dialogue: 'Dialogue', parenthetical: 'Parenthetical',
  transition: 'Transition', 'dual-dialogue': 'Character',
};

function fdxParagraph(block: DocumentBlock): string {
  const kind = fdxTypes[block.kind] ?? 'Action';
  const number = block.kind === 'scene' && block.sceneNumber
    ? ` Number="${escapeXml(block.sceneNumber)}"` : '';
  return `<Paragraph Type="${kind}"${number}><Text>${escapeXml(block.text)}</Text></Paragraph>`;
}

export function exportFountain(document: ProjectDocument): string {
  const title = document.screenplay?.titlePage;
  const titlePage = title ? [
    title.title && `Title: ${title.title}`,
    title.author && `Author: ${title.author}`,
    title.contact && `Contact:\n${title.contact.split('\n').map(line => `   ${line}`).join('\n')}`,
  ].filter(Boolean).join('\n') + '\n\n' : '';
  return titlePage + document.blocks.map(block => {
    if (block.kind === 'page-break') return '===\n';
    if (block.kind === 'scene' && block.sceneNumber) return `${block.text} #${block.sceneNumber}#\n`;
    if (block.kind === 'dual-dialogue') return `${block.text === block.text.toLocaleUpperCase() ? block.text : `@${block.text}`} ^\n`;
    if (block.kind === 'character') return `${block.text === block.text.toLocaleUpperCase() ? block.text : `@${block.text}`}\n`;
    if (block.kind === 'transition') return `> ${block.text}\n`;
    return `${block.text}\n`;
  }).join('\n');
}

export function exportFdx(document: ProjectDocument): string {
  const paragraphs: string[] = [];
  const blocks = document.blocks;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.kind === 'page-break') continue;
    if (block.kind === 'character') {
      let rightStart = index + 1;
      while (blocks[rightStart]?.kind === 'parenthetical' || blocks[rightStart]?.kind === 'dialogue') rightStart++;
      if (blocks[rightStart]?.kind === 'dual-dialogue') {
        let end = rightStart + 1;
        while (blocks[end]?.kind === 'parenthetical' || blocks[end]?.kind === 'dialogue') end++;
        if (blocks.slice(index + 1, rightStart).some(item => item.kind === 'dialogue')
          && blocks.slice(rightStart + 1, end).some(item => item.kind === 'dialogue')) {
          paragraphs.push(`<Paragraph Type="General"><DualDialogue>${blocks.slice(index, end)
            .map(fdxParagraph).join('')}</DualDialogue></Paragraph>`);
          index = end - 1;
          continue;
        }
      }
    }
    paragraphs.push(fdxParagraph(block));
  }
  return `<?xml version="1.0" encoding="UTF-8"?><FinalDraft DocumentType="Script" Template="No" Version="1"><Content>${paragraphs.join('')}</Content></FinalDraft>`;
}

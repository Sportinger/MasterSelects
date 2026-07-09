export interface FlashBoardChatEditOption {
  index: number;
  title: string;
  description: string;
}

export function buildFlashBoardChatEditOptionsPrompt(userPrompt: string): string {
  return [
    userPrompt.trim(),
    '',
    'Before editing, propose 3 distinct text-only edit options for this request.',
    'Do not call tools and do not modify the timeline yet.',
    'Format exactly:',
    'OPTION 1: Short title',
    'Clear description of the edit approach.',
    'OPTION 2: Short title',
    'Clear description of the edit approach.',
    'OPTION 3: Short title',
    'Clear description of the edit approach.',
    'End with: Choose an option to apply.',
  ].join('\n');
}

export function buildFlashBoardChatApplyOptionPrompt(option: FlashBoardChatEditOption): string {
  return [
    `Apply option ${option.index}: ${option.title}`,
    option.description,
    '',
    'Execute the required MasterSelects tools now. Do not propose more options.',
  ].join('\n');
}

export function parseFlashBoardChatEditOptions(response: string): FlashBoardChatEditOption[] {
  const options: FlashBoardChatEditOption[] = [];
  const lines = response.split(/\r?\n/);
  let current: FlashBoardChatEditOption | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const optionMatch = /^option\s+(\d+)\s*[:.)-]\s*(.*)$/i.exec(line);

    if (optionMatch) {
      if (current) options.push(current);
      current = {
        index: Number(optionMatch[1]),
        title: optionMatch[2]?.trim() || `Option ${optionMatch[1]}`,
        description: '',
      };
      continue;
    }

    if (current && line) {
      current.description = current.description ? `${current.description}\n${line}` : line;
    }
  }

  if (current) options.push(current);
  return options.length >= 2 ? options.slice(0, 3) : [];
}

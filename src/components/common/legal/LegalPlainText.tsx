// Renders the plain-text legal documents (shared with the confirmation email)
// as headings and paragraphs, so the page and the email carry the same words.

interface LegalPlainTextProps {
  text: string;
}

function isHeading(block: string, index: number): 'h3' | 'h4' | null {
  if (block.includes('\n')) return null;
  if (index === 0) return 'h3';
  if (/^\d+\.\s/.test(block) && block.length <= 90) return 'h4';
  if (block.length <= 40 && !/[.:!?]$/.test(block)) return 'h4';
  return null;
}

export function LegalPlainText({ text }: LegalPlainTextProps) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  return (
    <div className="legal-text legal-plain-text">
      {blocks.map((block, index) => {
        const heading = isHeading(block, index);
        const key = `${index}-${block.slice(0, 24)}`;
        if (heading === 'h3') {
          const [title, ...rest] = block.split('\n');
          return (
            <div key={key}>
              <h3>{title}</h3>
              {rest.length > 0 && <p className="legal-meta">{rest.join(' ')}</p>}
            </div>
          );
        }
        if (heading === 'h4') return <h4 key={key}>{block}</h4>;
        const lines = block.split('\n');
        return (
          <p key={key}>
            {lines.map((line, lineIndex) => (
              <span key={`${key}-${lineIndex}`}>
                {line}
                {lineIndex < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

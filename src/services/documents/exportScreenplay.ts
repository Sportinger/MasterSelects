import type { ProjectDocument } from '../../types/documents';
import { paginateScreenplay, screenplayMetrics, screenplayTitlePage } from './screenplayLayout';
import fontUrl from '../../assets/fonts/CourierPrime-Regular.ttf?url';

export async function exportScreenplayPdf(document: ProjectDocument): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import('pdf-lib'), import('@pdf-lib/fontkit'),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontResponse = await fetch(fontUrl);
  if (!fontResponse.ok) throw new Error('The bundled screenplay font is unavailable.');
  const font = await pdf.embedFont(await fontResponse.arrayBuffer());
  const titlePage = screenplayTitlePage(document);
  const pages = titlePage ? [titlePage, ...paginateScreenplay(document)] : paginateScreenplay(document);
  for (const pageModel of pages) {
    const page = pdf.addPage([pageModel.width, pageModel.height]);
    if (!pageModel.titlePage && document.screenplay?.header) page.drawText(document.screenplay.header, {
      x: 108, y: pageModel.height - 48, size: screenplayMetrics.fontSize, font,
    });
    if (!pageModel.titlePage) page.drawText(pageModel.label, {
      x: pageModel.width - 72, y: pageModel.height - 48, size: screenplayMetrics.fontSize, font,
    });
    for (const line of pageModel.lines) {
      if (!line.text) continue;
      const revision = document.screenplay?.revisions.find(item => item.id === line.revisionId);
      const hex = revision?.color.replace('#', '');
      const color = hex && /^[\da-f]{6}$/iu.test(hex) ? rgb(
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255,
      ) : undefined;
      page.drawText(line.text, { x: line.x, y: pageModel.height - line.y,
        size: screenplayMetrics.fontSize, font, ...(color ? { color } : {}) });
    }
    if (!pageModel.titlePage && document.screenplay?.footer) page.drawText(document.screenplay.footer, {
      x: 108, y: 48, size: screenplayMetrics.fontSize, font,
    });
  }
  const bytes = await pdf.save();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

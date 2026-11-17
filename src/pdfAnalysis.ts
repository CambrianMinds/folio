import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Config } from './config';
GlobalWorkerOptions.workerSrc = worker;
export interface Finding {
  page: number;
  kind: 'overflow' | 'heading' | 'sparse' | 'font' | 'overlap';
  message: string;
}
export interface Analysis {
  pages: number;
  findings: Finding[];
}
export function loadPdf(pdf: string) {
  return getDocument({
    data: Uint8Array.from(atob(pdf), (s) => s.charCodeAt(0)),
    isEvalSupported: false,
    wasmUrl: '/pdfjs/wasm/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  });
}
export async function pageCount(pdf: string): Promise<number> {
  const task = loadPdf(pdf);
  const doc = await task.promise;
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}
export async function analyzeDocument(
  doc: PDFDocumentProxy,
  c: Config,
  source: string,
  fonts: string[],
  canceled: () => boolean,
): Promise<Analysis> {
  const findings: Finding[] = [];
  const headings = source
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) =>
      l
        .replace(/^#+\s*/, '')
        .replace(/[*_`]/g, '')
        .trim()
        .toLowerCase(),
    );
  for (const font of [...new Set([c.bodyFont, c.headingFont])])
    if (
      fonts.length &&
      !fonts.some((f) => f.toLowerCase() === font.toLowerCase()) &&
      font !== 'Libertinus Serif'
    )
      findings.push({
        page: 1,
        kind: 'font',
        message: `${font} is not installed. A fallback typeface is being used.`,
      });
  for (let index = 1; index <= doc.numPages; index++) {
    if (canceled()) return { pages: doc.numPages, findings: [] };
    const page = await doc.getPage(index),
      vp = page.getViewport({ scale: 1 }),
      text = await page.getTextContent();
    const left = c.mirrored && index % 2 === 0 ? c.marginRight : c.marginLeft,
      right = c.mirrored && index % 2 === 0 ? c.marginLeft : c.marginRight;
    const lines = text.items
      .filter(
        (
          item,
        ): item is typeof item & {
          str: string;
          transform: number[];
          width: number;
          height: number;
        } => 'str' in item && item.str.trim().length > 0,
      )
      .map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: vp.height - item.transform[5],
        width: item.width,
        height: item.height,
      }));
    const body = lines.filter(
      (l) => l.y >= c.marginTop - 3 && l.y <= vp.height - c.marginBottom + 3,
    );
    if (body.some((l) => l.x < left - 2 || l.x + l.width > vp.width - right + 2))
      findings.push({
        page: index,
        kind: 'overflow',
        message:
          'Text extends beyond the side margins. Review tables, code, or long unbroken text.',
      });
    const ordinary=body.filter(l=>l.height>=c.fontSize*.8&&l.width>=c.fontSize*3).sort((a,b)=>a.y-b.y);
    let collision=false;
    for(let i=0;i<ordinary.length&&!collision;i++)for(let j=i+1;j<ordinary.length;j++){const a=ordinary[i],b=ordinary[j],gap=b.y-a.y,height=Math.min(a.height,b.height);if(gap>Math.max(a.height,b.height))break;if(gap>height*.2&&gap<height*.8&&Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>3){collision=true;break;}}
    if(collision)findings.push({page:index,kind:'overlap',message:'Text lines may overlap. Increase line or paragraph spacing and inspect this page.'});
    const bottom = Math.max(...body.map((l) => l.y));
    const lastRow = body
      .filter((l) => Math.abs(l.y - bottom) < 3)
      .sort((a, b) => a.x - b.x)
      .map((l) => l.text)
      .join(' ')
      .trim()
      .toLowerCase();
    if (headings.includes(lastRow))
      findings.push({
        page: index,
        kind: 'heading',
        message: 'A heading may be stranded at the end of this page. Review the transition.',
      });
    if (
      index === doc.numPages &&
      index > 1 &&
      body.length &&
      body.map((l) => l.text).join('').length < 250 &&
      bottom - c.marginTop < (vp.height - c.marginTop - c.marginBottom) * 0.25
    )
      findings.push({
        page: index,
        kind: 'sparse',
        message:
          'The final page contains little text. Consider adjusting spacing or reviewing page breaks.',
      });
  }
  return { pages: doc.numPages, findings };
}

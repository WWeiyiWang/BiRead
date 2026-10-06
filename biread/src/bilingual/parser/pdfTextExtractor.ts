import { blockRect, sameRegion } from "./pdfImages";
import { extractTextTables } from "./textTables";
import {
  removePageFurniture,
  assignSections,
  type TextPage,
} from "./documentStructure";
import type { DocumentData, Rect } from "../types";
import { DOCUMENT_PARSER_VERSION } from "../types";
import { readingOrder } from "./readingOrder";
import { segmentPage, inferHierarchy } from "./blockSegmenter";

export async function extractDocument(
  pdf: any,
  identity: string,
  fingerprint: string,
  onPage: (page: number, count: number) => void,
  cancelled: () => boolean,
): Promise<DocumentData> {
  if (typeof pdf.getPageData !== "function")
    throw new Error(
      "This Zotero reader does not expose structured character positions. Please update Zotero. OCR is not used.",
    );
  const document: DocumentData = {
    version: 1,
    parserVersion: DOCUMENT_PARSER_VERSION,
    identity,
    fingerprint,
    blocks: [],
    emptyPages: [],
    furniture: [],
  };
  const references = { active: false };
  const labels = await pdf.getPageLabels();
  const pages: TextPage[] = [];
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    if (cancelled()) throw new Error("Cancelled");
    const page = await pdf.getPageData({ pageIndex });
    const glyphs = readingOrder(page.chars || []);
    if (!glyphs.length) document.emptyPages.push(pageIndex);
    pages.push({ glyphs, box: Array.from(page.viewBox) as TextPage["box"] });
    onPage(pageIndex + 1, pdf.numPages);
    await Zotero.Promise.delay(0);
  }
  const cleanPages = removePageFurniture(pages);
  for (let pageIndex = 0; pageIndex < cleanPages.length; pageIndex++) {
    if (cancelled()) throw new Error("Cancelled");
    const { glyphs, box } = cleanPages[pageIndex];
    const label = labels?.[pageIndex] || String(pageIndex + 1);
    const retainedIndices = new Set(glyphs.map((g) => g.index));
    let graphics: Rect[] = [];
    if (pdf.getGraphics) {
      try {
        graphics = await pdf.getGraphics(pageIndex);
      } catch (error) {
        Zotero.logError(error as Error);
      }
    }
    document.furniture!.push({
      pageIndex,
      box,
      glyphs: pages[pageIndex].glyphs.filter(
        (g) => !retainedIndices.has(g.index),
      ),
      rules: graphics.filter(
        (r) =>
          r[3] - r[1] <= 2 &&
          r[2] - r[0] > 30 &&
          (r[1] > box[3] - (box[3] - box[1]) * 0.1 ||
            r[3] < box[1] + (box[3] - box[1]) * 0.08),
      ),
    });
    const initial = segmentPage(
      glyphs,
      pageIndex,
      label,
      box[3] - box[1] || 0,
      { ...references },
    );
    let tables: ReturnType<typeof extractTextTables> = {
      cells: [],
      consumed: new Set(),
    };
    if (
      pdf.getGraphics &&
      initial.some((b) => b.kind === "caption" && /^table\s*\d/i.test(b.source))
    ) {
      try {
        tables = extractTextTables(glyphs, graphics, initial);
      } catch (error) {
        Zotero.logError(error as Error);
      }
    }
    const retained: typeof glyphs = [];
    for (const g of glyphs) {
      if (tables.consumed.has(g.index)) {
        const previous = retained[retained.length - 1];
        if (previous) {
          previous.lineBreakAfter = true;
          previous.paragraphBreakAfter = true;
        }
      } else retained.push({ ...g });
    }
    const pageBlocks = segmentPage(
      retained,
      pageIndex,
      label,
      box[3] - box[1] || 0,
      references,
    );
    pageBlocks.push(...tables.cells);
    pageBlocks.sort(
      (a, b) =>
        (a.anchors[0]?.charIndex ?? Infinity) -
        (b.anchors[0]?.charIndex ?? Infinity),
    );
    const unique = pageBlocks.filter(
      (block, index) =>
        !pageBlocks
          .slice(0, index)
          .some(
            (other) =>
              !block.table &&
              !other.table &&
              block.source.replace(/\s+/g, "") ===
                other.source.replace(/\s+/g, "") &&
              sameRegion(blockRect(block), blockRect(other), 0.78),
          ),
    );
    document.blocks.push(
      ...unique.map((block) => ({ ...block, pageBox: box })),
    );
    await Zotero.Promise.delay(0);
  }
  if (!document.blocks.length)
    throw new Error(
      "No selectable text found. Scanned PDFs are not supported in this version.",
    );
  inferHierarchy(document.blocks);
  assignSections(document.blocks);
  return document;
}

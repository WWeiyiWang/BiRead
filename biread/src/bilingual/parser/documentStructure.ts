import type { Block, Glyph, Rect } from "../types";
export interface TextPage {
  glyphs: Glyph[];
  box: Rect;
}
export function textLines(glyphs: Glyph[]): Glyph[][] {
  const lines: Glyph[][] = [];
  let line: Glyph[] = [];
  for (const glyph of glyphs) {
    line.push(glyph);
    if (glyph.lineBreakAfter || glyph.paragraphBreakAfter) {
      lines.push(line);
      line = [];
    }
  }
  if (line.length) lines.push(line);
  return lines;
}
export function lineText(line: Glyph[]) {
  return line
    .map((g) => g.text + (g.spaceAfter ? " " : ""))
    .join("")
    .trim();
}
function bounds(line: Glyph[]): Rect {
  return [
    Math.min(...line.map((g) => g.rect[0])),
    Math.min(...line.map((g) => g.rect[1])),
    Math.max(...line.map((g) => g.rect[2])),
    Math.max(...line.map((g) => g.rect[3])),
  ];
}
/** Repeated margin lines are identified across pages. Footnotes are retained. */
export function removePageFurniture(pages: TextPage[]): TextPage[] {
  const candidates: {
    page: number;
    line: Glyph[];
    key: string;
    number: boolean;
    sideMark: boolean;
  }[] = [];
  const occurrences = new Map<string, Set<number>>();
  pages.forEach((page, index) => {
    const [x0, y0, x1, y1] = page.box,
      w = x1 - x0,
      h = y1 - y0;
    let noteContinuation = false;
    for (const line of textLines(page.glyphs)) {
      const text = lineText(line),
        r = bounds(line),
        center = (r[1] + r[3]) / 2;
      const noteStart =
        center < y0 + h * 0.22 &&
        /^(?:\d{1,2}|[*†‡])\s*[A-Za-z\u4e00-\u9fff]/.test(text);
      const note: boolean = noteStart || noteContinuation;
      noteContinuation = note && !line[line.length - 1].paragraphBreakAfter;
      const top = center > y1 - h * 0.08,
        bottom = center < y0 + h * 0.065;
      const number =
        (center > y1 - h * 0.045 || center < y0 + h * 0.055) &&
        /^(?:[-–—]\s*)?(?:\d{1,5}|[ivxlcdm]{1,8})(?:\s*[-–—])?$/i.test(text);
      const sideMark =
        /^arxiv:/i.test(text) &&
        (r[0] < x0 + w * 0.07 || r[2] > x1 - w * 0.07) &&
        r[3] - r[1] > r[2] - r[0];
      if (!top && !bottom && !sideMark) continue;
      if (note && !number) continue;
      // A numbered bottom note is content even if its wording recurs.
      if (
        bottom &&
        !number &&
        /^(?:\d{1,2}|[*†‡])\s*[A-Za-z\u4e00-\u9fff]/.test(text)
      )
        continue;
      if (text.length > 160 || !text) continue;
      const sizes = line
        .map((g) => g.fontSize || g.rect[3] - g.rect[1])
        .sort((a, b) => a - b);
      const style = Math.round(sizes[Math.floor(sizes.length / 2)] * 2);
      const key =
        (top ? "top:" : "bottom:") +
        style +
        ":" +
        Math.round(((center - y0) / h) * 80) +
        ":" +
        text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
      candidates.push({ page: index, line, key, number, sideMark });
      const seen = occurrences.get(key) || new Set<number>();
      seen.add(index);
      occurrences.set(key, seen);
    }
  });
  const removed = pages.map(() => new Set<number>());
  const minimum = pages.length < 5 ? 2 : 3;
  for (const c of candidates) {
    if (
      c.number ||
      c.sideMark ||
      (occurrences.get(c.key)?.size || 0) >= minimum
    )
      for (const g of c.line) removed[c.page].add(g.index);
  }
  return pages.map((p, index) => ({
    ...p,
    glyphs: p.glyphs.filter((g) => !removed[index].has(g.index)),
  }));
}
export function assignSections(blocks: Block[]) {
  const headings: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      const level = block.headingLevel || 1;
      while (
        headings.length &&
        (headings[headings.length - 1].headingLevel || 1) >= level
      )
        headings.pop();
      headings.push(block);
    }
    block.sectionID = headings[headings.length - 1]?.id;
    block.sectionPath = headings.map((b) => b.source);
    // Small bottom-of-page notes stay in the text stream, with their note number.
    if (
      block.kind === "paragraph" &&
      block.anchors.length &&
      /^\s*(?:\d{1,2}|[*†‡])\s*[^\d\s]/.test(block.source)
    ) {
      const top = Math.max(...block.anchors.map((a) => a.rect[3]));
      const body = blocks
        .filter(
          (b) =>
            b.pageIndex === block.pageIndex &&
            b.kind === "paragraph" &&
            b.source.length > 160,
        )
        .map((b) => b.fontSize || 0)
        .filter(Boolean)
        .sort((a, b) => a - b);
      const size = body[Math.floor(body.length / 2)];
      if (
        top < block.pageHeight * 0.22 &&
        size &&
        (block.fontSize || size) < size * 0.94
      )
        block.kind = "footnote";
    }
  }
}

import type { Block, Glyph, Rect } from "../types";
export interface TextPage {
  glyphs: Glyph[];
  box: Rect;
}

export function identifyFrontMatter(blocks: Block[]) {
  const first = blocks.filter((b) => b.pageIndex === 0);
  const title = first.findIndex((b) => b.kind === "title");
  for (const [i, b] of first.entries()) {
    const text = b.source.trim();
    const affiliation =
      /\b(?:university|institute|department|school of|laborator(?:y|ies))\b/i.test(
        text,
      );
    const nameStart = /^(?:[A-Z]\.\s*){1,3}[A-Z][a-z-]+/.test(text);
    const authorLine =
      i === title + 1 &&
      title >= 0 &&
      text.length < 450 &&
      text.split(",").length >= 3 &&
      !/\b(?:we|this study|demonstrates?|investigat\w*)\b/i.test(text);
    if (
      authorLine ||
      (affiliation && nameStart && text.length < 650) ||
      /^The ORCID identification/i.test(text)
    ) {
      b.kind = "author-info";
      delete b.headingLevel;
    } else if (
      /^(?:©\s*\d{4}|copyright\s*\d{4}|(?:https?:\/\/)?www\.|research article\s*$)/i.test(
        text,
      )
    ) {
      b.kind = "publication-info";
      delete b.headingLevel;
    }
  }
}

/** Some journals omit a References heading. Require a numbered bibliography
 * sequence and author initials in the document tail, not a lone prose citation. */
export function identifyReferences(blocks: Block[]) {
  const lastPage = Math.max(0, ...blocks.map((b) => b.pageIndex));
  let active = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (
      /^(?:references|bibliography|works cited|参考文献)\s*[:：]?$/i.test(
        b.source.trim(),
      )
    ) {
      active = true;
      continue;
    }
    if (/^(?:appendix|supplementary material)\b/i.test(b.source.trim()))
      active = false;
    if (
      !active &&
      b.pageIndex >= Math.floor(lastPage * 0.65) &&
      /^\[1\]\s*[A-Z](?:\.|[a-z-])/i.test(b.source.trim())
    ) {
      const sample = blocks
        .slice(i, i + 12)
        .map((x) => x.source)
        .join(" ");
      const entries = [
        ...sample.matchAll(/\[(\d+)\]\s*([A-Z][\w-]*\.|[A-Z]\.)/g),
      ];
      active =
        entries.length >= 3 &&
        entries.slice(0, 3).every((m, n) => Number(m[1]) === n + 1) &&
        /(?:19|20)\d{2}/.test(sample);
    }
    if (
      active &&
      !b.originalRegion &&
      !["caption", "footnote", "equation"].includes(b.kind)
    ) {
      b.kind = "reference";
      delete b.headingLevel;
    }
  }
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
    publication: boolean;
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
      // Standalone publisher identifiers at the margin are not prose footnotes.
      // An inline DOI in a paragraph or reference is deliberately retained.
      const publication =
        (center > y1 - h * 0.1 || center < y0 + h * 0.12) &&
        /^(?:(?:e-?|p-?)?ISSN\s*[:：]?\s*[\dXx-]+|(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)10\.\S+|PII\s*:\s*\S+|\d{4}-[\dXx]{4}\/.*see front matter.*|(?:©|copyright)\s*\d{4}.*rights reserved.*)\s*$/i.test(
          text,
        );
      const number =
        (center > y1 - h * 0.045 || center < y0 + h * 0.055) &&
        /^(?:[-–—]\s*)?(?:\d{1,5}|[ivxlcdm]{1,8})(?:\s*[-–—])?$/i.test(text);
      const sideMark =
        (r[0] < x0 + w * 0.07 || r[2] > x1 - w * 0.07) &&
        r[3] - r[1] > r[2] - r[0] &&
        /arxiv:|downloaded from|terms and conditions|wiley online library|creative commons license/i.test(
          text,
        );
      if (!top && !bottom && !sideMark && !publication) continue;
      if (note && !number && !publication && !sideMark) continue;
      // A numbered bottom note is content even if its wording recurs.
      if (
        bottom &&
        !number &&
        /^(?:\d{1,2}|[*†‡])\s*[A-Za-z\u4e00-\u9fff]/.test(text)
      )
        continue;
      if ((text.length > 160 && !sideMark) || !text) continue;
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
      candidates.push({
        page: index,
        line,
        key,
        number,
        sideMark,
        publication,
      });
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
      c.publication ||
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

/** Keep bottom notes out of the prose stream before paragraph segmentation. */
export function separateFootnotes(page: TextPage) {
  const sizes = page.glyphs
    .map((g) => g.fontSize || g.rect[3] - g.rect[1])
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 0;
  const body: Glyph[] = [],
    notes: Glyph[] = [];
  let previous: Rect | undefined;
  const bottom = page.box[1] + (page.box[3] - page.box[1]) * 0.25;
  for (const line of textLines(page.glyphs)) {
    const r = bounds(line);
    const small =
      line.filter(
        (g) => (g.fontSize || g.rect[3] - g.rect[1]) < bodySize * 0.94,
      ).length >
      line.length * 0.7;
    const authorNote = /^\s*[*†‡]?\s*corresponding author\b/i.test(
      lineText(line),
    );
    const begins =
      authorNote || /^(?:\d{1,3}\s+|[*†‡]\s*)[^\d\s]/u.test(lineText(line));
    const continues =
      previous &&
      r[3] <= previous[3] &&
      previous[1] - r[3] < bodySize * 1.5 &&
      Math.abs(r[0] - previous[0]) < bodySize * 3;
    if (
      !line.some((g) => g.rotation) &&
      (small || authorNote) &&
      r[3] < bottom &&
      (begins || continues)
    ) {
      notes.push(...line.map((g) => ({ ...g })));
      previous = r;
    } else {
      body.push(...line.map((g) => ({ ...g })));
      previous = undefined;
    }
  }
  return { body, notes };
}

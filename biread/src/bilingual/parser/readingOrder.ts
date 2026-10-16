import type { Glyph } from "../types";

// Zotero's getPageData returns processed reading order, including column and
// paragraph boundaries. Preserve it; sorting all glyphs by Y interleaves columns.
export function readingOrder(chars: any[]): Glyph[] {
  const result: Glyph[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (
      c.ignorable ||
      typeof c.u !== "string" ||
      !c.rect ||
      c.rect.length !== 4
    )
      continue;
    const rect = Array.from(c.rect, Number) as Glyph["rect"];
    if (!rect.every(Number.isFinite)) continue;
    result.push({
      text: c.u,
      rotation: Number(c.rotation) || 0,
      rect,
      index: i,
      fontSize:
        Number(c.fontSize) ||
        Math.abs((c.inlineRect || rect)[3] - (c.inlineRect || rect)[1]),
      bold: !!c.bold,
      italic: !!c.italic,
      spaceAfter: !!c.spaceAfter,
      lineBreakAfter: !!c.lineBreakAfter,
      paragraphBreakAfter: !!c.paragraphBreakAfter,
    });
  }
  // Font runs (notably italic book titles) sometimes carry artificial breaks.
  // Only join runs on the same physical baseline and with a small inline gap;
  // never join separate columns or vertically separated paragraphs.
  for (let i = 0; i + 1 < result.length; i++) {
    const a = result[i],
      b = result[i + 1];
    const size = Math.min(a.fontSize || 10, b.fontSize || 10);
    const gap = b.rect[0] - a.rect[2];
    if (
      (a.lineBreakAfter || a.paragraphBreakAfter) &&
      !a.rotation &&
      !b.rotation &&
      Math.abs(a.rect[1] - b.rect[1]) < size * 0.25 &&
      gap >= -size * 0.15 &&
      gap < size * 0.8
    ) {
      a.lineBreakAfter = false;
      a.paragraphBreakAfter = false;
      if (gap > size * 0.18) a.spaceAfter = true;
    }
  }
  return result;
}

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
  return result;
}

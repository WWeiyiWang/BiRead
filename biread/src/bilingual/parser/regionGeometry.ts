import type { Block, Rect } from "../types";
import { blockRect } from "./pdfImages";

export const overlapX = (a: Rect, b: Rect) =>
  Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
export const gapY = (a: Rect, b: Rect) => Math.max(a[1] - b[3], b[1] - a[3], 0);

/** Use a canonical page coordinate system, independent of PDF UserUnit and
 * nonzero MediaBox origins. Restore all anchors before returning to the reader. */
export function pageGeometry(box: Rect) {
  const scale = (box[2] - box[0]) / 600 || 1;
  const rect = (r: Rect, restore = false): Rect =>
    r.map((v, i) =>
      restore ? v * scale + box[i % 2] : (v - box[i % 2]) / scale,
    ) as Rect;
  const block = (b: Block, restore = false): Block => {
    const result = {
      ...b,
      anchors: b.anchors.map((a) => ({ ...a, rect: rect(a.rect, restore) })),
    };
    const factor = restore ? scale : 1 / scale;
    if (b.fontSize !== undefined) result.fontSize = b.fontSize * factor;
    if (b.pageHeight !== undefined) result.pageHeight = b.pageHeight * factor;
    if (b.pageBox) result.pageBox = rect(b.pageBox, restore);
    if (b.originalRegion)
      result.originalRegion = {
        ...b.originalRegion,
        rect: rect(b.originalRegion.rect, restore),
      };
    if (b.inlineMath)
      result.inlineMath = b.inlineMath.map((m) => ({
        ...m,
        rect: rect(m.rect, restore),
      }));
    if (b.table) {
      result.table = { ...b.table, rect: rect(b.table.rect, restore) };
      if (b.table.columns)
        result.table.columns = b.table.columns.map((x) =>
          restore ? x * scale + box[0] : (x - box[0]) / scale,
        );
    }
    return result;
  };
  return { rect, block, canonical: rect(box) };
}

/** A gutter needs evidence from parallel prose columns. A right-aligned
 * equation number or narrow caption alone does not establish a second column. */
export function contentLane(
  owner: Block,
  blocks: Block[],
  box: Rect,
): [number, number] {
  const r = blockRect(owner),
    width = box[2] - box[0];
  const prose = blocks
    .filter(
      (b) =>
        b !== owner &&
        b.pageIndex === owner.pageIndex &&
        ["paragraph", "abstract", "reference"].includes(b.kind) &&
        !b.originalRegion &&
        b.source.length > (/[\u4e00-\u9fff]/.test(b.source) ? 40 : 100) &&
        b.anchors.length,
    )
    .map(blockRect)
    .filter((q) => q[2] - q[0] >= width * 0.2 && q[2] - q[0] < width * 0.6);
  const gutters: { x: number; distance: number }[] = [];
  for (const a of prose)
    for (const b of prose) {
      if (b[0] - a[2] < 8 || b[0] - a[2] > width * 0.16) continue;
      const sharedHeight = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (sharedHeight < Math.min(a[3] - a[1], b[3] - b[1]) * 0.25) continue;
      gutters.push({
        x: (a[2] + b[0]) / 2,
        distance: Math.min(gapY(r, a), gapY(r, b)),
      });
    }
  const gutter = gutters.sort((a, b) => a.distance - b.distance)[0];
  if (!gutter) return [box[0], box[2]];
  if (r[2] <= gutter.x) return [box[0], gutter.x];
  if (r[0] >= gutter.x) return [gutter.x, box[2]];
  return [box[0], box[2]];
}

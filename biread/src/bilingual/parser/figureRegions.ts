import type { Block, Rect } from "../types";
import {
  blockRect,
  imagePlacements,
  imageRect,
  multiply,
  type Matrix,
} from "./pdfImages";
export function graphicsRects(list: {
  fnArray: number[];
  argsArray: any[];
}): Rect[] {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const result = imagePlacements(list).map((i) => i.rect);
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i],
      a = list.argsArray[i] || [];
    if (op === 10 || op === 74 || op === 76) {
      stack.push([...m]);
      if (op === 74 && a[0]) m = multiply(m, a[0]);
      if (op === 76 && a[0]?.matrix) m = multiply(m, a[0].matrix);
    } else if (op === 11 || op === 75 || op === 77)
      m = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === 12) m = multiply(m, a as Matrix);
    else if (op === 91 && a[2]?.length === 4) {
      const r = a[2];
      const rect = imageRect(
        multiply(m, [r[2] - r[0], 0, 0, r[3] - r[1], r[0], r[1]]),
      );
      if (rect.every(Number.isFinite)) result.push(rect);
    }
  }
  return result;
}
const union = (a: Rect, b: Rect): Rect => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];
const xOverlap = (a: Rect, b: Rect) =>
  Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
/** A caption-adjacent graphic cluster, never a whole-page preview. */
function regionAbove(
  caption: Block,
  graphics: Rect[],
  pageBox: Rect,
  blocks: Block[],
): Rect | undefined {
  if (!caption.anchors.length) return;
  const c = blockRect(caption),
    width = pageBox[2] - pageBox[0],
    height = pageBox[3] - pageBox[1];
  const otherCaptions = blocks
    .filter(
      (b) =>
        b.pageIndex === caption.pageIndex &&
        b.id !== caption.id &&
        b.kind === "caption" &&
        b.anchors.length,
    )
    .map(blockRect)
    .filter((r) => r[1] > c[3] && xOverlap(c, r) > 0);
  const boundary = Math.min(pageBox[3], ...otherCaptions.map((r) => r[1] - 2));
  const candidates = graphics.filter(
    (r) =>
      xOverlap(c, r) > 0 &&
      r[1] >= c[3] - 3 &&
      r[3] > c[3] + 4 &&
      r[3] <= boundary &&
      r[2] - r[0] < width * 0.97 &&
      r[3] - r[1] < height * 0.8,
  );
  candidates.sort((a, b) => a[1] - b[1]);
  const seed = candidates.find((r) => r[2] - r[0] > 12 || r[3] - r[1] > 12);
  if (!seed || seed[1] - c[3] > 100) return;
  let region: Rect = [...seed];
  let changed = true;
  const taken = new Set<Rect>([seed]);
  while (changed) {
    changed = false;
    for (const r of candidates) {
      if (taken.has(r)) continue;
      const dx = Math.max(region[0] - r[2], r[0] - region[2], 0);
      const dy = Math.max(region[1] - r[3], r[1] - region[3], 0);
      if (dx <= 30 && dy <= 30) {
        region = union(region, r);
        taken.add(r);
        changed = true;
      }
    }
  }
  if (
    region[2] - region[0] < 35 ||
    region[3] - region[1] < 25 ||
    region[3] - region[1] > height * 0.78
  )
    return;
  // Include nearby diagram labels, but stop before ordinary prose above it.
  let top = Math.min(pageBox[3], region[3] + 18);
  for (const b of blocks) {
    if (
      b.pageIndex !== caption.pageIndex ||
      b.id === caption.id ||
      !b.anchors.length
    )
      continue;
    const r = blockRect(b);
    if (b.source.length > 100 && r[1] >= region[3] && xOverlap(r, region) > 0)
      top = Math.min(top, r[1] - 2);
  }
  return [
    Math.max(pageBox[0], region[0] - 10),
    Math.max(c[3] + 2, region[1] - 12),
    Math.min(pageBox[2], region[2] + 10),
    Math.max(region[3], top),
  ];
}

const reflect = (r: Rect): Rect => [r[0], -r[3], r[2], -r[1]];
/** Tables usually follow their captions; figures usually precede them.
 * Try the preferred side first and keep neighbouring captions as boundaries. */
export function figureRegion(
  caption: Block,
  graphics: Rect[],
  pageBox: Rect,
  blocks: Block[],
): Rect | undefined {
  const pageBlocks = blocks.filter((b) => b.pageIndex === caption.pageIndex);
  const below = () => {
    const mirrored = pageBlocks.map((b) => ({
      ...b,
      anchors: b.anchors.map((a) => ({ ...a, rect: reflect(a.rect) })),
    }));
    const c = mirrored.find((b) => b.id === caption.id);
    if (!c) return;
    const found = regionAbove(
      c,
      graphics.map(reflect),
      reflect(pageBox),
      mirrored,
    );
    return found && reflect(found);
  };
  const above = () => regionAbove(caption, graphics, pageBox, pageBlocks);
  return /^table\b/i.test(caption.source.trim())
    ? below() || above()
    : above() || below();
}
/** Only whole blocks within the successful preview may be folded. */
export function tableTextBlocks(
  captionID: string,
  pageIndex: number,
  rect: Rect,
  blocks: Block[],
): Block[] {
  return blocks.filter(
    (b) =>
      b.pageIndex === pageIndex &&
      b.id !== captionID &&
      !["caption", "title", "footnote"].includes(b.kind) &&
      b.anchors.length > 0 &&
      b.anchors.every((a) => {
        const x = (a.rect[0] + a.rect[2]) / 2,
          y = (a.rect[1] + a.rect[3]) / 2;
        return x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3];
      }),
  );
}

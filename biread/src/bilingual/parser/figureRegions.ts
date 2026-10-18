import type { Block, Rect } from "../types";
import { contentLane, pageGeometry } from "./regionGeometry";
import { captionKind } from "./regionLabels";
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
  let paths: Rect[] = [];
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
    // Monochrome masks are complete illustrations/formulas in many journals.
    // Their pixels need the PDF paint colour, so use them for region discovery
    // and let the PDF renderer produce the preview instead of decoding as RGB.
    else if (op === 83 || op === 90) result.push(imageRect(m));
    else if (op === 84 || op === 87) {
      for (const entry of (op === 84 ? a[0] : a[1]) || [])
        if (entry.transform?.length === 6)
          result.push(imageRect(multiply(m, entry.transform)));
    } else if (op === 89 && a[5]) {
      for (let j = 0; j < a[5].length; j += 2)
        result.push(
          imageRect(
            multiply(m, [a[1], a[2], a[3], a[4], a[5][j], a[5][j + 1]]),
          ),
        );
    } else if (op === 91 && a[2]?.length === 4) {
      const r = a[2];
      const rect = imageRect(
        multiply(m, [r[2] - r[0], 0, 0, r[3] - r[1], r[0], r[1]]),
      );
      if (rect.every(Number.isFinite)) {
        // Recent PDF.js combines construction and painting in one operator;
        // older builds emit the paint operator separately.
        if (typeof a[0] === "number") {
          if (a[0] >= 20 && a[0] <= 27) result.push(rect);
        } else paths.push(rect);
      }
    } else if (op >= 20 && op <= 28) {
      // constructPath also describes clipping windows around text and tiles.
      // Only painted paths are visible artwork; endPath consumes a clip-only
      // path without painting it. Treating these windows as figures crops prose.
      if (op !== 28) result.push(...paths);
      paths = [];
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
  // A centred caption can be much narrower than its full multi-panel figure.
  // Only parallel captions constrain the horizontal lane; caption width does not.
  let [laneLeft, laneRight] = contentLane(
    caption,
    blocks.filter((b) => b.anchors.length && blockRect(b)[3] > c[3] + 4),
    pageBox,
  );
  const cx = (c[0] + c[2]) / 2;
  const wideGraphic = graphics.some(
    (r) =>
      r[2] - r[0] > width * 0.6 &&
      r[3] - r[1] > 25 &&
      r[1] >= c[3] - 3 &&
      r[1] - c[3] < 100 &&
      r[3] <= boundary,
  );
  if (wideGraphic) [laneLeft, laneRight] = [pageBox[0], pageBox[2]];
  for (const b of blocks) {
    if (b === caption || b.kind !== "caption" || !b.anchors.length) continue;
    const q = blockRect(b),
      qx = (q[0] + q[2]) / 2;
    if (xOverlap(c, q) > 0) continue;
    if (
      Math.abs(q[3] - c[3]) > 24 &&
      !(
        c[2] - c[0] > width * 0.2 &&
        q[2] - q[0] > width * 0.2 &&
        c[2] - c[0] < width * 0.48 &&
        q[2] - q[0] < width * 0.48 &&
        !wideGraphic
      )
    )
      continue;
    if (qx < cx) laneLeft = Math.max(laneLeft, (qx + cx) / 2);
    else laneRight = Math.min(laneRight, (qx + cx) / 2);
  }
  // Selectable table cells and diagram labels can bridge disconnected drawing
  // assets. They must be small-type fragments above this caption, not prose.
  const connectors = blocks
    .filter(
      (b) =>
        b !== caption &&
        b.kind === "paragraph" &&
        b.anchors.length &&
        b.source.length < 140 &&
        (b.source.trim().split(/\s+/).length <= 7 ||
          ((b.source.match(/\b\d+(?:\.\d+)?\b/g) || []).length >= 6 &&
            (b.source.match(/[A-Za-z]{3,}/g) || []).length <= 3) ||
          (b.fontSize || 10) < (caption.fontSize || 10) * 0.92 ||
          !!b.rotation) &&
        !/[.!?]\s*$/.test(b.source) &&
        !!caption.fontSize &&
        !!b.fontSize &&
        b.fontSize <= caption.fontSize * 1.15,
    )
    .flatMap((b) => b.anchors.map((a) => a.rect));
  const eligible = (r: Rect) =>
    r[0] >= laneLeft - 3 &&
    r[2] <= laneRight + 3 &&
    r[1] >= c[3] - 3 &&
    r[3] > c[3] + 4 &&
    r[3] <= boundary &&
    r[2] - r[0] < width * 0.97 &&
    r[3] - r[1] < height * 0.8;
  const graphicTop = Math.max(
    c[3],
    ...graphics.filter((r) => eligible(r) && r[3] - r[1] > 4).map((r) => r[3]),
  );
  const candidates = [
    ...graphics,
    ...connectors.filter((r) => r[3] <= graphicTop + 12),
  ].filter(
    (r) =>
      r[0] >= laneLeft - 3 &&
      r[2] <= laneRight + 3 &&
      r[1] >= c[3] - 3 &&
      r[3] > c[3] + 4 &&
      r[3] <= boundary &&
      r[2] - r[0] < width * 0.97 &&
      r[3] - r[1] < height * 0.8,
  );
  const prose = blocks
    .filter(
      (b) =>
        b !== caption &&
        b.anchors.length &&
        ["paragraph", "abstract", "reference", "heading"].includes(b.kind) &&
        (b.source.length > (/[\u4e00-\u9fff]/.test(b.source) ? 40 : 100) ||
          (b.source.length > 15 &&
            (b.fontSize || 0) > (caption.fontSize || 10) * 1.08 &&
            (b.source.match(/[A-Za-z]{3,}/g) || []).length >= 3)),
    )
    .map(blockRect);
  // A section number can be emitted separately from its adjacent heading.
  // Match that actual run rather than widening prose across a column gutter.
  for (const b of blocks) {
    if (
      !b.anchors.length ||
      !/^(?:[IVXLCDM]+|\d+(?:\.\d+)*|[A-Z])[.)]?$/.test(b.source.trim()) ||
      (b.fontSize || 0) <= (caption.fontSize || 10) * 1.08
    )
      continue;
    const r = blockRect(b),
      size = b.fontSize || 10;
    if (
      prose.some(
        (p) =>
          p[0] >= r[2] &&
          p[0] - r[2] < size * 3 &&
          Math.min(p[3], r[3]) - Math.max(p[1], r[1]) > size * 0.5,
      )
    )
      prose.push(r);
  }
  const crossesProse = (a: Rect, b: Rect) =>
    prose.some((p) => {
      const low = Math.min(a[3], b[3]),
        high = Math.max(a[1], b[1]);
      return (
        p[1] > low && p[3] < high && xOverlap(p, a) > 0 && xOverlap(p, b) > 0
      );
    });
  const clearCandidates = candidates.filter(
    (r) =>
      !prose.some(
        (p) =>
          xOverlap(p, r) > 2 &&
          (Math.min(p[3], r[3]) - Math.max(p[1], r[1]) >
            Math.max(5, Math.min(p[3] - p[1], r[3] - r[1]) * 0.2) ||
            (r[3] - r[1] < 2 && r[1] >= p[1] - 3 && r[3] <= p[3] + 1)),
      ),
  );
  clearCandidates.sort((a, b) => a[1] - b[1]);
  const seed = clearCandidates.find(
    (r) =>
      graphics.includes(r) &&
      xOverlap(c, r) > 0 &&
      (r[2] - r[0] > 12 || r[3] - r[1] > 12),
  );
  if (!seed || seed[1] - c[3] > 100 || crossesProse(c, seed)) return;
  let region: Rect = [...seed];
  let changed = true;
  const taken = new Set<Rect>([seed]);
  while (changed) {
    changed = false;
    for (const r of clearCandidates) {
      if (taken.has(r)) continue;
      const dx = Math.max(region[0] - r[2], r[0] - region[2], 0);
      const dy = Math.max(region[1] - r[3], r[1] - region[3], 0);
      const alignedPanels =
        xOverlap(region, r) >
        Math.min(region[2] - region[0], r[2] - r[0]) * 0.6;
      const verticalGap = alignedPanels
        ? Math.max(30, (caption.fontSize || 10) * 5)
        : 30;
      if (dx <= 30 && dy <= verticalGap && !crossesProse(region, r)) {
        region = union(region, r);
        taken.add(r);
        changed = true;
      }
    }
  }
  if (
    region[2] - region[0] < 35 ||
    region[3] - region[1] < 12 ||
    region[3] - region[1] > height * 0.78
  )
    return;
  // Include nearby diagram labels, but stop before ordinary prose above it.
  let top = Math.min(pageBox[3], region[3] + 4);
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
  const geometry = pageGeometry(pageBox);
  const normalized = blocks.map((b) => geometry.block(b));
  const owner =
    normalized.find((b) => b.id === caption.id) || geometry.block(caption);
  const found = canonicalFigureRegion(
    owner,
    graphics.map((r) => geometry.rect(r)),
    geometry.canonical,
    normalized,
  );
  return found && geometry.rect(found, true);
}

function canonicalFigureRegion(
  caption: Block,
  graphics: Rect[],
  pageBox: Rect,
  blocks: Block[],
): Rect | undefined {
  const pageBlocks = blocks.filter((b) => b.pageIndex === caption.pageIndex);
  if (captionKind(caption.source) === "table") {
    const c = blockRect(caption),
      [left, right] = contentLane(caption, blocks, pageBox);
    const rows = pageBlocks
      .filter(
        (b) =>
          b !== caption &&
          b.kind === "paragraph" &&
          b.anchors.length &&
          (b.source.match(/\b\d+(?:\.\d+)?\b/g) || []).length >= 6 &&
          (b.source.match(/[A-Za-z]{3,}/g) || []).length <= 3,
      )
      .map(blockRect)
      .filter(
        (r) =>
          r[0] >= left &&
          r[2] <= right &&
          xOverlap(c, r) > 0 &&
          Math.max(c[1] - r[3], r[1] - c[3], 0) < 60 &&
          r[3] - r[1] >= 12 &&
          r[2] - r[0] > (pageBox[2] - pageBox[0]) * 0.25,
      );
    if (rows.length) {
      const closest = rows.sort(
        (a, b) =>
          Math.max(c[1] - a[3], a[1] - c[3], 0) -
          Math.max(c[1] - b[3], b[1] - c[3], 0),
      )[0];
      return [closest[0] - 2, closest[1] - 2, closest[2] + 2, closest[3] + 2];
    }
  }
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
  const up = above(),
    down = below();
  if (!up) return down;
  if (!down) return up;
  const c = blockRect(caption);
  const upGap = Math.max(0, up[1] - c[3]),
    downGap = Math.max(0, c[1] - down[3]);
  if (Math.abs(upGap - downGap) > 5) return upGap < downGap ? up : down;
  return captionKind(caption.source) === "table" ? down : up;
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

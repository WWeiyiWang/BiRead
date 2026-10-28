import type { Block, Rect } from "../types";
import { blockRect } from "./pdfImages";
import { segmentText } from "../alignment/segmentAlignment";

export interface LayoutRegion {
  label: string;
  confidence: number;
  rect: Rect;
}
const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
function coverage(a: Rect, b: Rect) {
  return (
    area([
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.min(a[2], b[2]),
      Math.min(a[3], b[3]),
    ]) / Math.max(1, area(a))
  );
}
const union = (rects: Rect[]): Rect => [
  Math.min(...rects.map((r) => r[0])),
  Math.min(...rects.map((r) => r[1])),
  Math.max(...rects.map((r) => r[2])),
  Math.max(...rects.map((r) => r[3])),
];
function join(blocks: Block[]): Block {
  const first = blocks[0];
  let source = "";
  const anchors: Block["anchors"] = [],
    inlineMath: NonNullable<Block["inlineMath"]> = [];
  for (const b of blocks) {
    if (source) source += " ";
    const offset = source.length;
    source += b.source;
    anchors.push(
      ...b.anchors.map((a) => ({
        ...a,
        start: a.start + offset,
        end: a.end + offset,
      })),
    );
    inlineMath.push(...(b.inlineMath || []));
  }
  return {
    ...first,
    source,
    anchors,
    inlineMath,
    segments: segmentText(source, first.id),
  };
}
/** High-confidence regions constrain heuristics; unknown/overlapping areas remain untouched. */
export function applyModelLayout(
  input: Block[],
  regions: LayoutRegion[],
  box: Rect,
  phase: "regions" | "flow" | "all" = "all",
): Block[] {
  const reliable = regions.filter(
    (r) =>
      r.confidence >= 0.8 &&
      r.rect.length === 4 &&
      r.rect.every(Number.isFinite) &&
      area(r.rect) > 0 &&
      coverage(r.rect, box) > 0.98,
  );
  let blocks = input.map((b) => ({ ...b }));
  // A native Fig./Table caption anchor corroborates a weaker model caption box.
  // This joins its wrapped description without guessing from font size alone.
  if (phase !== "flow")
    for (const region of regions.filter(
      (r) =>
        ["figure_caption", "table_caption"].includes(r.label) &&
        r.confidence >= 0.55 &&
        r.rect.length === 4 &&
        r.rect.every(Number.isFinite) &&
        area(r.rect) > 0 &&
        coverage(r.rect, box) > 0.98,
    )) {
      const members = blocks.filter(
        (b) =>
          !b.table &&
          ["caption", "paragraph"].includes(b.kind) &&
          coverage(blockRect(b), region.rect) > 0.9,
      );
      const caption = members.find(
        (b) =>
          b.kind === "caption" &&
          /^(?:fig(?:ure)?\.?|table|图|表)\s*/i.test(b.source),
      );
      if (!caption) continue;
      const merged = join([caption, ...members.filter((b) => b !== caption)]);
      merged.kind = "caption";
      const used = new Set(members);
      blocks = blocks.flatMap((b) =>
        b === caption ? [merged] : used.has(b) ? [] : [b],
      );
    }
  for (const region of reliable.filter(
    (r) =>
      phase !== "flow" &&
      ["figure", "table", "isolate_formula"].includes(r.label),
  )) {
    if (region.label === "isolate_formula") {
      const labels = reliable.filter(
        (label) =>
          label.label === "formula_caption" &&
          label.rect[0] >= region.rect[2] &&
          Math.abs(
            (label.rect[1] + label.rect[3] - region.rect[1] - region.rect[3]) /
              2,
          ) < 16 &&
          label.rect[0] - region.rect[2] < (box[2] - box[0]) * 0.45,
      );
      const containsCenters = (b: Block) =>
        b.anchors.length > 0 &&
        b.anchors.every((a) =>
          [region, ...labels].some((r) => {
            const x = (a.rect[0] + a.rect[2]) / 2,
              y = (a.rect[1] + a.rect[3]) / 2;
            return (
              x >= r.rect[0] - 1 &&
              x <= r.rect[2] + 1 &&
              y >= r.rect[1] - 1 &&
              y <= r.rect[3] + 1
            );
          }),
        );
      const inside = blocks.filter(
        (b) =>
          !b.table &&
          ["equation", "paragraph", "list"].includes(b.kind) &&
          (coverage(blockRect(b), region.rect) > 0.75 || containsCenters(b)) &&
          (b.source.match(/[A-Za-z]{3,}/g) || []).length < 4,
      );
      if (!inside.length) continue;
      const r = region.rect;
      const numbers = blocks.filter(
        (b) =>
          /^\(?\d+[a-z]?\)?$/.test(b.source.trim()) &&
          reliable.some(
            (label) =>
              label.label === "formula_caption" &&
              coverage(blockRect(b), label.rect) > 0.8,
          ) &&
          blockRect(b)[0] > r[2] &&
          Math.abs((blockRect(b)[1] + blockRect(b)[3] - r[1] - r[3]) / 2) <
            12 &&
          blockRect(b)[0] - r[2] < box[2] * 0.45,
      );
      const members = [
        ...inside,
        ...numbers.filter((b) => !inside.includes(b)),
      ];
      const merged = join(members);
      merged.kind = "equation";
      merged.originalRegion = {
        kind: "equation",
        rect: union([r, ...members.map(blockRect)]),
      };
      const set = new Set(members);
      blocks = blocks.flatMap((b) =>
        b === inside[0] ? [merged] : set.has(b) ? [] : [b],
      );
    } else {
      const candidates = blocks.filter(
        (b) =>
          b.kind === "caption" &&
          (region.label === "table"
            ? /^(?:table|表)\s*/i
            : /^(?:fig(?:ure)?\.?|图)\s*/i
          ).test(b.source),
      );
      const distance = (b: Block) => {
        const r = blockRect(b);
        return Math.min(
          Math.abs(r[3] - region.rect[1]),
          Math.abs(r[1] - region.rect[3]),
        );
      };
      const nearby = candidates
        .filter((b) => {
          const r = blockRect(b);
          return (
            Math.min(r[2], region.rect[2]) - Math.max(r[0], region.rect[0]) >
              Math.min(r[2] - r[0], region.rect[2] - region.rect[0]) * 0.3 &&
            distance(b) < 80
          );
        })
        .sort((a, b) => distance(a) - distance(b));
      if (
        !nearby.length ||
        (nearby[1] && distance(nearby[1]) - distance(nearby[0]) < 8)
      )
        continue;
      const caption = nearby[0];
      caption.originalRegion = {
        kind: region.label === "table" ? "table" : "figure",
        rect: region.rect,
      };
      blocks = blocks.filter(
        (b) =>
          b === caption ||
          b.kind === "caption" ||
          coverage(blockRect(b), region.rect) < 0.9,
      );
    }
  }
  for (const region of reliable.filter(
    (r) => phase !== "regions" && r.label === "plain text",
  )) {
    const inside = blocks.filter(
      (b) =>
        !b.originalRegion &&
        !b.table &&
        ["paragraph", "list", "heading"].includes(b.kind) &&
        coverage(blockRect(b), region.rect) > 0.94,
    );
    if (
      !inside.length ||
      inside.some((b) =>
        reliable.some(
          (r) =>
            r !== region &&
            r.label === "title" &&
            coverage(blockRect(b), r.rect) > 0.6,
        ),
      )
    )
      continue;
    // Do not combine distinct columns or swallow a genuine section heading.
    if (
      inside.some((b) =>
        /^\s*(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+[A-Z][A-Za-z ]{2,60}$/.test(
          b.source,
        ),
      )
    )
      continue;
    const merged = join(inside);
    merged.kind = "paragraph";
    merged.bold = false;
    merged.layoutRole = "prose";
    const members = new Set(inside);
    blocks = blocks.flatMap((b) =>
      b === inside[0] ? [merged] : members.has(b) ? [] : [b],
    );
  }
  return blocks;
}

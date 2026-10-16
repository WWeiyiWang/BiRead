import type { Block, Rect } from "../types";
import { blockRect } from "./pdfImages";
import { figureRegion } from "./figureRegions";
import { segmentText } from "../alignment/segmentAlignment";

const union = (a: Rect, b: Rect): Rect => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];
const contains = (r: Rect, b: Block) =>
  b.anchors.length > 0 &&
  b.anchors.every((a) => {
    const x = (a.rect[0] + a.rect[2]) / 2,
      y = (a.rect[1] + a.rect[3]) / 2;
    return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  });
/** Preserve complete non-prose regions before translation, including formula fragments. */
export function preserveOriginalRegions(
  blocks: Block[],
  graphics: Rect[],
  box: Rect,
): Block[] {
  const removed = new Set<Block>();
  for (const owner of blocks) {
    if (removed.has(owner) || !owner.anchors.length) continue;
    const equation = owner.kind === "equation";
    const table = owner.kind === "caption" && /^table\s*\d/i.test(owner.source);
    if (!equation && !table) continue;
    let r = blockRect(owner);
    const members: Block[] = [];
    if (equation) {
      // PDF text order frequently emits numerator, subscript and denominator
      // separately. Absorb only short, nearby fragments, never surrounding prose.
      const seed = [...r] as Rect,
        pad = Math.max(12, (owner.fontSize || 10) * 2);
      for (const b of blocks) {
        if (
          b === owner ||
          removed.has(b) ||
          !b.anchors.length ||
          b.source.length > 32 ||
          b.kind === "caption" ||
          b.kind === "heading"
        )
          continue;
        const q = blockRect(b);
        if (
          q[0] >= seed[0] - Math.max(24, pad) &&
          q[2] <= seed[2] + Math.max(24, pad) &&
          q[1] >= seed[1] - pad &&
          q[3] <= seed[3] + pad
        ) {
          r = union(r, q);
          members.push(b);
        }
      }
    } else {
      const cells = blocks.filter((b) => b.table?.captionID === owner.id);
      let region =
        cells[0]?.table?.rect || figureRegion(owner, graphics, box, blocks);
      // Rotated tables have a vertical caption and parallel vertical text runs.
      const c = blockRect(owner);
      if (owner.rotation === 90 || owner.rotation === 270) {
        const nextCaption = Math.min(
          box[2] - 18,
          ...blocks
            .filter(
              (b) =>
                b !== owner &&
                b.kind === "caption" &&
                b.rotation === owner.rotation &&
                b.anchors.length &&
                blockRect(b)[0] > c[2],
            )
            .map((b) => blockRect(b)[0] - 2),
        );
        const vertical = blocks
          .filter((b) => b !== owner && b.anchors.length && !removed.has(b))
          .filter((b) => {
            const q = blockRect(b);
            return (
              b.rotation === owner.rotation &&
              q[0] >= c[0] - 4 &&
              q[2] < nextCaption &&
              q[0] - c[0] < (box[2] - box[0]) * 0.5 &&
              q[1] >= box[1] + 25 &&
              q[3] <= box[3] - 25
            );
          });
        if (vertical.length >= 4)
          region = vertical.reduce((a, b) => union(a, blockRect(b)), c);
      }
      if (!region) continue;
      r = region;
      members.push(
        ...blocks.filter(
          (b) =>
            b !== owner &&
            contains(r, b) &&
            !["title", "caption"].includes(b.kind) &&
            (b.kind !== "footnote" ||
              (!!owner.rotation && b.rotation === owner.rotation)),
        ),
      );
    }
    owner.originalRegion = {
      kind: equation ? "equation" : "table",
      rect: r.map((v, i) =>
        Math.max(box[i % 2], Math.min(box[(i % 2) + 2], v + (i < 2 ? -3 : 3))),
      ) as Rect,
    };
    if (equation) {
      for (const b of members) {
        const offset = owner.source.length + 1;
        owner.source += " " + b.source;
        owner.anchors.push(
          ...b.anchors.map((a) => ({
            ...a,
            start: a.start + offset,
            end: a.end + offset,
          })),
        );
      }
      owner.segments = segmentText(owner.source, owner.id);
    }
    for (const b of members) removed.add(b);
  }
  return blocks.filter((b) => !removed.has(b));
}

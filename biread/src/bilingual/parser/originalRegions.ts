import type { Block, Rect } from "../types";
import { blockRect } from "./pdfImages";
import { figureRegion } from "./figureRegions";
import { segmentText } from "../alignment/segmentAlignment";
import {
  preserveInlineMath,
  isMathFragment,
  splitMathContinuations,
} from "./inlineMath";
import { embedInlineMath } from "./embedInlineMath";

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
  blocks = splitMathContinuations(blocks);
  const removed = new Set<Block>();
  for (const b of blocks) {
    if (
      b.kind === "equation" &&
      /\b(?:where|which|the|and|for)\b/.test(b.source)
    )
      b.kind = "paragraph";
  }
  // Numbered display equations are a spatial band, not a stream of words.
  // This also captures font-private glyphs used for tall brackets and roots.
  for (const owner of blocks) {
    if (
      removed.has(owner) ||
      !owner.anchors.length ||
      !/\(\d{1,3}\)\s*$/.test(owner.source) ||
      owner.source.length > 240 ||
      (owner.source.match(/[A-Za-z]{3,}/g) || []).length > 1
    )
      continue;
    const seed = blockRect(owner);
    const mid = (box[0] + box[2]) / 2;
    const left = seed[0] >= mid ? mid : box[0];
    const right = seed[0] >= mid ? box[2] : mid;
    const parts: Block[] = [];
    let band = seed;
    for (let changed = true; changed; ) {
      changed = false;
      for (const b of blocks) {
        if (
          b === owner ||
          parts.includes(b) ||
          removed.has(b) ||
          !b.anchors.length ||
          !isMathFragment(b.source) ||
          /\(\d{1,3}\)\s*$/.test(b.source)
        )
          continue;
        const r = blockRect(b),
          joined = union(band, r);
        if (
          r[0] < left ||
          r[2] > right ||
          joined[3] - joined[1] > 100 ||
          Math.max(band[1] - r[3], r[1] - band[3], 0) > 12
        )
          continue;
        const center = (r[1] + r[3]) / 2,
          origin = (seed[1] + seed[3]) / 2;
        const crossesProse = blocks.some(
          (p) =>
            p !== owner &&
            p.anchors.length &&
            !isMathFragment(p.source) &&
            (() => {
              const q = blockRect(p),
                y = (q[1] + q[3]) / 2;
              return (
                q[0] >= left &&
                q[2] <= right + 3 &&
                y > Math.min(center, origin) &&
                y < Math.max(center, origin)
              );
            })(),
        );
        if (crossesProse) continue;
        parts.push(b);
        band = joined;
        changed = true;
      }
    }
    if (!parts.length) continue;
    const rect = parts.reduce((r, b) => union(r, blockRect(b)), seed);
    owner.kind = "equation";
    owner.originalRegion = {
      kind: "equation",
      rect: [rect[0] - 3, rect[1] - 3, rect[2] + 3, rect[3] + 3],
    };
    for (const b of parts) {
      const offset = owner.source.length + 1;
      owner.source += " " + b.source;
      owner.anchors.push(
        ...b.anchors.map((a) => ({
          ...a,
          start: a.start + offset,
          end: a.end + offset,
        })),
      );
      removed.add(b);
    }
    owner.segments = segmentText(owner.source, owner.id);
  }
  for (const block of blocks) {
    if (
      block.kind === "paragraph" &&
      block.source.length < 180 &&
      /[=∑∫∏∝≈≠≤≥]/.test(block.source) &&
      /\(\d{1,3}\)\s*$/.test(block.source) &&
      (block.source.match(/[a-zA-Z]{3,}/g) || []).length < 3
    )
      block.kind = "equation";
  }
  for (const owner of blocks) {
    if (removed.has(owner) || !owner.anchors.length) continue;
    if (owner.originalRegion?.kind === "equation") continue;
    const equation = owner.kind === "equation";
    const table = owner.kind === "caption" && /^table\s*\d/i.test(owner.source);
    const figure =
      owner.kind === "caption" && /^fig(?:ure)?\.?\s*\d/i.test(owner.source);
    if (!equation && !table && !figure) continue;
    let r = blockRect(owner);
    const members: Block[] = [];
    if (equation) {
      // PDF text order frequently emits numerator, subscript and denominator
      // separately. Absorb only short, nearby fragments, never surrounding prose.
      const seed = [...r] as Rect,
        pad = Math.max(12, (owner.fontSize || 10) * 2);
      for (let changed = true; changed; ) {
        changed = false;
        for (const b of blocks) {
          if (
            b === owner ||
            members.includes(b) ||
            removed.has(b) ||
            !b.anchors.length ||
            !isMathFragment(b.source) ||
            b.kind === "caption" ||
            b.kind === "heading"
          )
            continue;
          const q = blockRect(b);
          if (
            Math.max(r[0] - q[2], q[0] - r[2], 0) <= pad &&
            Math.max(r[1] - q[3], q[1] - r[3], 0) <= 8 &&
            Math.max(r[2], q[2]) - Math.min(r[0], q[0]) <
              (box[2] - box[0]) * 0.6 &&
            q[1] >= seed[1] - pad &&
            q[3] <= seed[3] + pad
          ) {
            r = union(r, q);
            members.push(b);
            changed = true;
          }
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
      if (figure) {
        // Small-type, adjacent caption columns can contain math emitted in
        // separate PDF runs. Preserve their geometry instead of reflowing it.
        const captionSize = owner.fontSize || 0;
        let band = union(r, c);
        const captionParts = new Set<Block>();
        let expanded = true;
        while (expanded && captionSize) {
          expanded = false;
          for (const b of blocks) {
            if (
              b === owner ||
              captionParts.has(b) ||
              !b.anchors.length ||
              !["paragraph", "list", "equation"].includes(b.kind) ||
              !b.fontSize ||
              (owner.bold && !b.bold && !isMathFragment(b.source)) ||
              b.fontSize > captionSize * 1.08
            )
              continue;
            const q = blockRect(b);
            if (
              q[0] < r[0] ||
              q[2] > r[2] ||
              q[3] > c[3] + 2 ||
              q[3] < band[1] - captionSize * 1.8 ||
              q[1] > band[3]
            )
              continue;
            captionParts.add(b);
            band = union(band, q);
            expanded = true;
          }
        }
        // Only replace the caption when it has fragmented continuation runs.
        if (captionParts.size > 0) {
          // Keep the original caption in the image for mathematical typography,
          // but retain a single text stream for its translated explanation.
          for (const part of [...captionParts].sort(
            (a, b) =>
              (a.anchors[0]?.charIndex || 0) - (b.anchors[0]?.charIndex || 0),
          )) {
            const offset = owner.source.length + 1;
            owner.source += " " + part.source;
            owner.anchors.push(
              ...part.anchors.map((a) => ({
                ...a,
                start: a.start + offset,
                end: a.end + offset,
              })),
            );
          }
          owner.segments = segmentText(owner.source, owner.id);
          r = band;
          owner.originalRegion = {
            kind: "figure",
            rect: r,
            includesCaption: true,
          };
        }
      }
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
      kind: equation ? "equation" : table ? "table" : "figure",
      includesCaption: owner.originalRegion?.includesCaption,
      rect: r.map((v, i) =>
        Math.max(box[i % 2], Math.min(box[(i % 2) + 2], v + (i < 2 ? -3 : 3))),
      ) as Rect,
    };
    if (figure && !owner.rotation && !owner.originalRegion.includesCaption) {
      const captionRect = blockRect(owner),
        padded = owner.originalRegion.rect;
      if (r[1] >= captionRect[3])
        padded[1] = Math.max(padded[1], captionRect[3] + 2);
      else if (r[3] <= captionRect[1])
        padded[3] = Math.min(padded[3], captionRect[1] - 2);
    }
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
  const retained = blocks.filter((b) => !removed.has(b));
  // A large formula may have multiple equation seeds; overlapping crops are
  // one visual object, including radical bars and tall bracket components.
  for (let i = 0; i < retained.length; i++) {
    const a = retained[i];
    if (a.kind !== "equation" || !a.originalRegion) continue;
    for (let j = i + 1; j < retained.length; j++) {
      const b = retained[j];
      if (
        b.pageIndex !== a.pageIndex ||
        b.kind !== "equation" ||
        !b.originalRegion
      )
        continue;
      const r = a.originalRegion.rect,
        q = b.originalRegion.rect;
      if (
        Math.min(r[2], q[2]) <= Math.max(r[0], q[0]) ||
        Math.min(r[3], q[3]) <= Math.max(r[1], q[1])
      )
        continue;
      a.originalRegion.rect = union(r, q);
      const offset = a.source.length + 1;
      a.source += " " + b.source;
      a.anchors.push(
        ...b.anchors.map((x) => ({
          ...x,
          start: x.start + offset,
          end: x.end + offset,
        })),
      );
      a.segments = segmentText(a.source, a.id);
      retained.splice(j--, 1);
    }
  }
  for (const a of retained) {
    if (a.kind !== "equation" || !a.originalRegion) continue;
    const r = a.originalRegion.rect;
    const glyphBottom = Math.min(...a.anchors.map((x) => x.rect[1]));
    const glyphTop = Math.max(...a.anchors.map((x) => x.rect[3]));
    for (const b of retained) {
      if (
        !["paragraph", "list"].includes(b.kind) ||
        !b.anchors.length ||
        isMathFragment(b.source)
      )
        continue;
      const q = blockRect(b);
      if (
        q[1] > (r[1] + r[3]) / 2 &&
        q[1] > glyphTop + 1 &&
        q[1] < r[3] &&
        Math.min(q[2], r[2]) > Math.max(q[0], r[0])
      )
        r[3] = q[1] - 1;
      if (
        q[3] < (r[1] + r[3]) / 2 &&
        q[3] < glyphBottom - 2 &&
        q[3] > r[1] &&
        Math.min(q[2], r[2]) > Math.max(q[0], r[0])
      )
        r[1] = q[3] + 2;
    }
  }
  return embedInlineMath(preserveInlineMath(retained));
}

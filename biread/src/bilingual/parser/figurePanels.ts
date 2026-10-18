import type { Block, Rect } from "../types";
import { blockRect } from "./pdfImages";
import { segmentText } from "../alignment/segmentAlignment";

/** Explicit Fig. 3a / 3b captions are panels of one numbered figure. Keep their
 * original panel labels inside one crop, but never cross intervening prose. */
export function mergeFigurePanels(blocks: Block[]): Block[] {
  const result = [...blocks];
  const label = (b: Block) =>
    b.kind === "caption" &&
    b.source.match(/^(fig(?:ure)?\.?)\s*([SA]?\d+)([a-z])(?=\s|[.:|]|$)/i);
  for (let i = 0; i < result.length; i++) {
    const a = result[i],
      first = label(a);
    if (!first || a.originalRegion?.kind !== "figure") continue;
    for (let j = i + 1; j < result.length; j++) {
      const b = result[j],
        second = label(b);
      if (
        !second ||
        a.pageIndex !== b.pageIndex ||
        b.originalRegion?.kind !== "figure" ||
        first[2] !== second[2] ||
        first[3] === second[3]
      )
        continue;
      const r = a.originalRegion.rect,
        q = b.originalRegion.rect;
      if (
        Math.max(r[1] - q[3], q[1] - r[3], 0) > 150 ||
        Math.max(r[0] - q[2], q[0] - r[2], 0) > 80
      )
        continue;
      const both = [r, q, blockRect(a), blockRect(b)];
      const union: Rect = [
        Math.min(...both.map((x) => x[0])),
        Math.min(...both.map((x) => x[1])),
        Math.max(...both.map((x) => x[2])),
        Math.max(...both.map((x) => x[3])),
      ];
      if (
        result.some(
          (p) =>
            p !== a &&
            p !== b &&
            p.kind === "paragraph" &&
            p.source.length > 80 &&
            p.anchors.some(
              (t) =>
                t.rect[0] > union[0] &&
                t.rect[2] < union[2] &&
                t.rect[1] > union[1] &&
                t.rect[3] < union[3],
            ),
        )
      )
        continue;
      const offset = a.source.length + 1;
      a.source += "\n" + b.source;
      a.anchors.push(
        ...b.anchors.map((t) => ({
          ...t,
          start: t.start + offset,
          end: t.end + offset,
        })),
      );
      a.originalRegion = { kind: "figure", rect: union, includesCaption: true };
      a.segments = segmentText(a.source, a.id);
      result.splice(j--, 1);
    }
  }
  return result;
}

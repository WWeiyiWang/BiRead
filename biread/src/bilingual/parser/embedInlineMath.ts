import type { Block } from "../types";
import { segmentText } from "../alignment/segmentAlignment";
import { equationNumber } from "./regionLabels";
export function embedInlineMath(blocks: Block[]): Block[] {
  const removed = new Set<Block>();
  for (let i = 1; i < blocks.length; i++) {
    const math = blocks[i];
    let previous = i - 1;
    while (previous >= 0 && removed.has(blocks[previous])) previous--;
    const prev = blocks[previous];
    if (!prev) continue;
    if (
      math.kind !== "equation" ||
      !math.originalRegion ||
      prev.kind !== "paragraph" ||
      prev.pageIndex !== math.pageIndex ||
      removed.has(prev) ||
      equationNumber(math.source, false)
    )
      continue;
    const r = math.originalRegion.rect,
      end = prev.anchors[prev.anchors.length - 1]?.rect;
    const wrapped =
      end &&
      r[3] <= end[1] + 2 &&
      Math.abs(r[0] - Math.min(...prev.anchors.map((a) => a.rect[0]))) < 20 &&
      r[2] - r[0] < 120 &&
      /\b(?:and|with|is|are|of|to)\s*$/.test(prev.source);
    if (
      !end ||
      Math.max(end[1] - r[3], r[1] - end[3], 0) > 5 ||
      (Math.abs(end[2] - r[0]) > 45 && !wrapped)
    )
      continue;
    const token = "$BIREAD_MATH_" + math.id + "$";
    prev.inlineMath ||= [];
    prev.inlineMath.push({ id: math.id, token, rect: r });
    prev.source += " " + token;
    removed.add(math);
    const next = blocks[i + 1];
    if (
      next?.kind === "paragraph" &&
      next.pageIndex === math.pageIndex &&
      next.anchors.length
    ) {
      const a = next.anchors[0].rect;
      if (
        Math.max(r[1] - a[3], a[1] - r[3], 0) < 15 &&
        a[0] >= Math.min(...prev.anchors.map((x) => x.rect[0])) - 5 &&
        a[0] < r[2] + 45
      ) {
        const offset = prev.source.length + 1;
        prev.source += " " + next.source;
        prev.anchors.push(
          ...next.anchors.map((a) => ({
            ...a,
            start: a.start + offset,
            end: a.end + offset,
          })),
        );
        removed.add(next);
      }
    }
    prev.segments = segmentText(prev.source, prev.id);
  }
  const result = blocks.filter((b) => !removed.has(b));
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1],
      b = result[i];
    if (
      !a.inlineMath?.length ||
      b.kind !== "paragraph" ||
      a.pageIndex !== b.pageIndex ||
      !/\b(?:in|the|of|and|as|is|which|for)\s*$/.test(a.source) ||
      !/^[a-z]/.test(b.source)
    )
      continue;
    const end = a.anchors.at(-1)?.rect,
      start = b.anchors[0]?.rect;
    if (
      !end ||
      !start ||
      Math.max(end[1] - start[3], start[1] - end[3], 0) > 15
    )
      continue;
    const offset = a.source.length + 1;
    a.source += " " + b.source;
    a.anchors.push(
      ...b.anchors.map((x) => ({
        ...x,
        start: x.start + offset,
        end: x.end + offset,
      })),
    );
    a.inlineMath.push(...(b.inlineMath || []));
    a.segments = segmentText(a.source, a.id);
    result.splice(i--, 1);
  }
  return result;
}

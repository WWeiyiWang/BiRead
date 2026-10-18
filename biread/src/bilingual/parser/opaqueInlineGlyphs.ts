import type { Block, Rect } from "../types";
import { segmentText } from "../alignment/segmentAlignment";

/** Preserve unmapped font glyphs in otherwise readable sentences. Never guess
 * their Unicode meaning; the PDF renderer still has the original font program. */
export function preserveOpaqueInlineGlyphs(blocks: Block[]): Block[] {
  for (const b of blocks) {
    if (
      b.kind !== "paragraph" ||
      b.originalRegion ||
      (b.source.match(/[A-Za-z]{3,}|[\u4e00-\u9fff]{2}/g) || []).length < 3
    )
      continue;
    const matches = [
      ...b.source.matchAll(/[^\s$]*[\ue000-\uf8ff\ufffd][^\s$]*/gu),
    ];
    for (const m of matches.reverse()) {
      const start = m.index!,
        end = start + m[0].length;
      if (m[0].length > 48) continue;
      const picked = b.anchors.filter((a) => a.start >= start && a.end <= end);
      if (!picked.length) continue;
      const r: Rect = [
        Math.min(...picked.map((a) => a.rect[0])),
        Math.min(...picked.map((a) => a.rect[1])),
        Math.max(...picked.map((a) => a.rect[2])),
        Math.max(...picked.map((a) => a.rect[3])),
      ];
      const size = b.fontSize || 10;
      if (r[2] - r[0] > size * 10 || r[3] - r[1] > size * 2) continue;
      const id = `${b.id}-glyph-${start}`,
        token = `$BIREAD_MATH_${id}$`;
      b.inlineMath ||= [];
      b.inlineMath.push({
        id,
        token,
        rect: [r[0] - 0.25, r[1] - 0.25, r[2] + 0.25, r[3] + 0.25],
      });
      const delta = token.length - (end - start);
      b.source = b.source.slice(0, start) + token + b.source.slice(end);
      b.anchors = b.anchors
        .filter((a) => !picked.includes(a))
        .map((a) =>
          a.start >= end
            ? { ...a, start: a.start + delta, end: a.end + delta }
            : a,
        );
    }
    if (matches.length) b.segments = segmentText(b.source, b.id);
  }
  return blocks;
}

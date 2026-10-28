import type { Block, Rect } from "../types";
export interface SourceLink {
  rect: Rect;
  targetPageIndex?: number;
  targetPoint?: [number, number];
  url?: string;
}
export interface ReadingLink {
  label: string;
  targetPageIndex?: number;
  targetPoint?: [number, number];
  url?: string;
  targetBlockID?: string;
  preview?: string;
}
const overlaps = (a: Rect, b: Rect) =>
  Math.min(a[2], b[2]) > Math.max(a[0], b[0]) &&
  Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
export function attachReferenceLinks(blocks: Block[], pages: SourceLink[][]) {
  for (const b of blocks) {
    const matches: ReadingLink[] = [];
    for (const link of pages[b.pageIndex] || []) {
      if (link.url && !/^https?:\/\//i.test(link.url)) continue;
      if (link.targetPageIndex === undefined && !link.url) continue;
      const anchors = b.anchors.filter((a) => overlaps(a.rect, link.rect));
      if (!anchors.length) continue;
      const start = Math.min(...anchors.map((a) => a.start)),
        end = Math.max(...anchors.map((a) => a.end));
      const label = b.source.slice(start, end).trim() || "原文链接";
      let target: Block | undefined;
      if (link.targetPageIndex !== undefined) {
        const candidates = blocks.filter(
          (t) => t.pageIndex === link.targetPageIndex,
        );
        if (link.targetPoint) {
          const [x, y] = link.targetPoint;
          target = candidates.find((t) =>
            t.anchors.some(
              (a) =>
                x >= a.rect[0] - 8 &&
                x <= a.rect[2] + 8 &&
                y >= a.rect[1] - 8 &&
                y <= a.rect[3] + 8,
            ),
          );
        }
        if (
          !target &&
          candidates.filter((t) => t.kind === "reference").length === 1
        )
          target = candidates.find((t) => t.kind === "reference");
      }
      matches.push({
        label,
        targetPageIndex: link.targetPageIndex,
        targetPoint: link.targetPoint,
        url: link.url,
        targetBlockID: target?.id,
        preview: target?.source,
      });
    }
    b.links = matches.filter(
      (l, i) =>
        matches.findIndex(
          (o) =>
            o.label === l.label &&
            o.url === l.url &&
            o.targetPageIndex === l.targetPageIndex &&
            JSON.stringify(o.targetPoint) === JSON.stringify(l.targetPoint),
        ) === i,
    );
  }
}

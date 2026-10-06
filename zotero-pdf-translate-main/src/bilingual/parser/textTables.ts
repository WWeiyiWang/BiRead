import type { Block, Glyph, Rect } from "../types";
import { blockRect } from "./pdfImages";
import { segmentText } from "../alignment/segmentAlignment";
const center = (g: Glyph) => [
  (g.rect[0] + g.rect[2]) / 2,
  (g.rect[1] + g.rect[3]) / 2,
];
const inside = (g: Glyph, r: Rect) => {
  const [x, y] = center(g);
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
};
function lines(glyphs: Glyph[]) {
  const out: Glyph[][] = [];
  for (const g of [...glyphs].sort(
    (a, b) => center(b)[1] - center(a)[1] || a.rect[0] - b.rect[0],
  )) {
    const line = out.find(
      (l) =>
        Math.abs(center(l[0])[1] - center(g)[1]) <
        Math.max(2, (g.fontSize || 9) * 0.25),
    );
    if (line) line.push(g);
    else out.push([g]);
  }
  return out.map((l) => l.sort((a, b) => a.rect[0] - b.rect[0]));
}
/** Full horizontal-rule runs, not a distance-limited graphics crop. */
export function textTableRegion(
  caption: Block,
  graphics: Rect[],
  blocks: Block[] = [],
): Rect | undefined {
  const c = blockRect(caption);
  const lowerBoundary = Math.max(
    -Infinity,
    ...blocks
      .filter(
        (b) =>
          b.id !== caption.id &&
          b.pageIndex === caption.pageIndex &&
          ["caption", "heading", "title"].includes(b.kind) &&
          b.anchors.length,
      )
      .map(blockRect)
      .filter((r) => r[3] < c[1] && r[2] > c[0] && r[0] < c[2])
      .map((r) => r[3]),
  );
  const rules = graphics.filter(
    (r) =>
      r[3] - r[1] < 1.5 &&
      r[2] - r[0] > 80 &&
      r[3] < c[3] &&
      r[1] > lowerBoundary &&
      r[2] > c[0] &&
      r[0] < c[2],
  );
  const top = rules
    .filter((r) => c[3] - r[3] < 65)
    .sort((a, b) => b[3] - a[3])[0];
  if (!top) return;
  const aligned = rules
    .filter((r) => Math.abs(r[0] - top[0]) < 3 && Math.abs(r[2] - top[2]) < 3)
    .sort((a, b) => b[3] - a[3]);
  const run: Rect[] = [];
  for (const r of aligned) {
    if (run.length && run[run.length - 1][1] - r[3] > 85) break;
    if (!run.length || Math.abs(run[run.length - 1][1] - r[1]) > 2) run.push(r);
  }
  if (run.length < 3 || top[3] - run[run.length - 1][1] < 25) return;
  return [top[0], run[run.length - 1][1], top[2], top[3]];
}
export function extractTextTables(
  glyphs: Glyph[],
  graphics: Rect[],
  blocks: Block[],
): { cells: Block[]; consumed: Set<number> } {
  const cells: Block[] = [];
  const consumed = new Set<number>();
  for (const caption of blocks.filter(
    (b) => b.kind === "caption" && /^table\s*\d/i.test(b.source),
  )) {
    const rect = textTableRegion(caption, graphics, blocks);
    if (!rect) continue;
    const chars = glyphs.filter((g) => inside(g, rect));
    if (chars.length < 12) continue;
    // Large filled areas/pictures are not text-only tables.
    if (
      graphics.some(
        (r) =>
          r[2] - r[0] > 20 &&
          r[3] - r[1] > 20 &&
          r[0] > rect[0] + 2 &&
          r[2] < rect[2] - 2 &&
          r[1] > rect[1] + 2 &&
          r[3] < rect[3] - 2,
      )
    )
      continue;
    const ys = [
      ...new Set(
        graphics
          .filter(
            (r) =>
              r[3] - r[1] < 1.5 &&
              Math.abs(r[0] - rect[0]) < 3 &&
              Math.abs(r[2] - rect[2]) < 3 &&
              r[1] >= rect[1] - 1 &&
              r[3] <= rect[3] + 1,
          )
          .map((r) => Math.round(r[1] * 2) / 2),
      ),
    ]
      .sort((a, b) => b - a)
      .filter((y, i, a) => !i || a[i - 1] - y > 2);
    if (ys.length < 3) continue;
    const bands = ys
      .slice(0, -1)
      .map((top, i) =>
        chars.filter(
          (g) => center(g)[1] <= top + 1 && center(g)[1] > ys[i + 1] - 1,
        ),
      );
    let cuts = graphics
      .filter(
        (r) =>
          r[2] - r[0] < 1.5 &&
          r[3] - r[1] > (rect[3] - rect[1]) * 0.35 &&
          r[0] > rect[0] + 3 &&
          r[2] < rect[2] - 3 &&
          r[1] >= rect[1] - 2 &&
          r[3] <= rect[3] + 2,
      )
      .map((r) => r[0]);
    if (!cuts.length) {
      const body = bands.slice(1).flat();
      const occupied = Array.from(
        { length: Math.ceil(rect[2] - rect[0]) + 1 },
        () => false,
      );
      for (const g of body)
        for (
          let x = Math.max(0, Math.floor(g.rect[0] - rect[0]));
          x <= Math.min(occupied.length - 1, Math.ceil(g.rect[2] - rect[0]));
          x++
        )
          occupied[x] = true;
      for (let x = 3; x < occupied.length - 3; x++) {
        if (occupied[x]) continue;
        let end = x;
        while (end < occupied.length - 3 && !occupied[end]) end++;
        if (end - x >= 9 && x > 6 && end < occupied.length - 6)
          cuts.push(rect[0] + (x + end) / 2);
        x = end;
      }
    }
    cuts = cuts
      .sort((a, b) => a - b)
      .filter((x, i, a) => !i || x - a[i - 1] > 4);
    if (!cuts.length || cuts.length > 15) continue;
    const columns = [rect[0], ...cuts, rect[2]];
    const id = caption.id + "-table";
    const built: Block[] = [];
    for (let row = 0; row < bands.length; row++) {
      const band = bands[row];
      if (!band.length) continue;
      // A full-width title in the first ruled band is a merged header cell.
      const physical = lines(band);
      const headerSpan =
        row === 0 &&
        physical.length === 1 &&
        cuts.some((c) =>
          physical[0].some(
            (g, i, gs) =>
              (g.rect[0] <= c && g.rect[2] >= c) ||
              (i > 0 &&
                gs[i - 1].rect[2] <= c &&
                g.rect[0] >= c &&
                g.rect[0] - gs[i - 1].rect[2] < 9),
          ),
        );
      const groups = headerSpan
        ? [band]
        : columns
            .slice(0, -1)
            .map((left, col) =>
              band.filter(
                (g) => center(g)[0] >= left && center(g)[0] < columns[col + 1],
              ),
            );
      for (let col = 0; col < groups.length; col++) {
        let source = "";
        const anchors: Block["anchors"] = [];
        const group = groups[col];
        for (const line of lines(group)) {
          if (source) source += "\n";
          for (let n = 0; n < line.length; n++) {
            const g = line[n],
              start = source.length;
            source += g.text;
            anchors.push({
              start,
              end: source.length,
              pageIndex: caption.pageIndex,
              charIndex: g.index,
              rect: g.rect,
            });
            const next = line[n + 1];
            if (
              next &&
              (g.spaceAfter ||
                next.rect[0] - g.rect[2] > (g.fontSize || 9) * 0.25)
            )
              source += " ";
          }
        }
        source = source.trimEnd();
        const cellID = id + "-r" + row + "-c" + col;
        built.push({
          ...caption,
          id: cellID,
          kind: "table-cell",
          source,
          anchors,
          segments: segmentText(source, cellID),
          fontSize: group[0]?.fontSize || 9,
          bold: row === 0,
          table: {
            id,
            captionID: caption.id,
            rect,
            columns,
            row,
            column: col,
            colSpan: headerSpan ? columns.length - 1 : 1,
            header: row === 0,
            rows: bands.length,
          },
        });
      }
    }
    if (built.filter((b) => b.source.trim()).length < 4) continue;
    cells.push(...built);
    for (const g of chars) consumed.add(g.index);
  }
  return { cells, consumed };
}

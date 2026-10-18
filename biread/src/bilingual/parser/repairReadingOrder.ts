import type { Glyph } from "../types";

/** Some native PDF extractors invent many narrow columns, even cutting words.
 * Reassemble only pages with repeated, geometrically touching out-of-order
 * runs. Real column gutters and mathematical superscripts remain separate. */
export function repairReadingOrder(glyphs: Glyph[]): Glyph[] {
  const lines: Glyph[][] = [];
  for (const g of glyphs) {
    const size = g.fontSize || 10;
    let line =
      !g.rotation &&
      lines.find(
        (a) =>
          !a[0].rotation &&
          Math.abs(a[0].rect[1] - g.rect[1]) < size * 0.12 &&
          Math.abs((a[0].fontSize || 10) - size) < size * 0.12,
      );
    if (!line) {
      line = [];
      lines.push(line);
    }
    line.push(g);
  }
  const runs: Glyph[][] = [];
  let fractures = 0;
  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.rect[0] - b.rect[0]);
    let run: Glyph[] = [];
    for (const g of sorted) {
      const prev = run.at(-1),
        size = g.fontSize || 10;
      if (prev && (g.rotation || g.rect[0] - prev.rect[2] > size * 1.1)) {
        runs.push(run);
        run = [];
      }
      const last = run.at(-1);
      if (
        last &&
        Math.abs(g.index - last.index) > 3 &&
        g.rect[0] - last.rect[2] < size * 0.2 &&
        /[A-Za-z]/.test(last.text) &&
        /[A-Za-z]/.test(g.text)
      )
        fractures++;
      run.push(g);
    }
    if (run.length) runs.push(run);
  }
  if (fractures < 12) return glyphs;
  runs.sort(
    (a, b) =>
      Math.min(...a.map((g) => g.index)) - Math.min(...b.map((g) => g.index)),
  );
  return runs.flatMap((run) => {
    const clean: Glyph[] = [];
    for (const g of run) {
      const prev = clean.at(-1),
        size = g.fontSize || 10;
      // Repeated boundary glyphs often appear in both adjacent native runs.
      if (
        prev &&
        prev.text === g.text &&
        g.rect.every((v, i) => Math.abs(v - prev.rect[i]) < size * 0.1)
      )
        continue;
      clean.push({ ...g });
    }
    for (let i = 0; i + 1 < clean.length; i++) {
      const g = clean[i],
        next = clean[i + 1];
      g.lineBreakAfter = false;
      g.paragraphBreakAfter = false;
      g.spaceAfter = next.rect[0] - g.rect[2] > (g.fontSize || 10) * 0.18;
    }
    if (clean.length) clean[clean.length - 1].lineBreakAfter = true;
    return clean;
  });
}

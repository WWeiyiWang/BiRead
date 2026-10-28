import type { Glyph, Rect } from "../types";

const bounds = (gs: Glyph[]): Rect => [
  Math.min(...gs.map((g) => g.rect[0])),
  Math.min(...gs.map((g) => g.rect[1])),
  Math.max(...gs.map((g) => g.rect[2])),
  Math.max(...gs.map((g) => g.rect[3])),
];
const size = (g: Glyph) => g.fontSize || g.rect[3] - g.rect[1];
const baseline = (g: Glyph) => g.baseline ?? g.rect[1] + size(g) * 0.27;
const wordText = (gs: Glyph[]) => gs.map((g) => g.text).join("");
// PDF text rectangles include the font's global descent even for a digit or
// an h. In tight lines that empty band contains ink from the NEXT prose line.
// Keep descenders, symbols and unknown glyphs intact; tighten only unaccented
// Latin/digit glyphs known not to descend below their recorded baseline.
const cropBounds = (gs: Glyph[]): Rect =>
  bounds(
    gs.map((g) => ({
      ...g,
      rect:
        g.baseline !== undefined &&
        /^[A-IK-PR-Za-fh-ik-or-xz0-9]+$/.test(g.text)
          ? [
              g.rect[0],
              Math.max(g.rect[1], g.baseline - size(g) * 0.08),
              g.rect[2],
              g.rect[3],
            ]
          : g.rect,
    })),
  );
interface Row {
  words: Glyph[][];
  baseline: number;
  size: number;
  rect: Rect;
  glyphs: Glyph[];
}

/** Recover inline objects BEFORE native run breaks become paragraphs. Math is
 * owned by a physical prose line, never by the preceding text-run index. A
 * fraction can therefore contain a delayed denominator/script and still sit
 * between the same two words. Ordinary words, neighbouring lines and columns
 * are barriers; display equations remain available to the region parser. */
export function restoreInlineFlow(input: Glyph[], pageIndex: number): Glyph[] {
  const glyphs = input.map((g) => ({ ...g }));
  const positions = new Map(glyphs.map((g, i) => [g, i]));
  const words: Glyph[][] = [];
  let pending: Glyph[] = [];
  const flush = () => {
    if (pending.length) words.push(pending);
    pending = [];
  };
  for (const g of glyphs) {
    const prev = pending.at(-1);
    if (
      prev &&
      (prev.spaceAfter ||
        prev.lineBreakAfter ||
        prev.paragraphBreakAfter ||
        Math.abs(baseline(g) - baseline(prev)) > size(prev) * 0.18 ||
        g.rect[0] < prev.rect[0] ||
        g.rect[0] - prev.rect[2] > size(prev) * 0.24)
    )
      flush();
    if (g.rotation || !/^[\p{L}\p{N}]+$/u.test(g.text)) {
      flush();
      continue;
    }
    pending.push(g);
  }
  flush();
  const proseWords = words.filter(
    (w) =>
      /^[\p{L}]{3,}$/u.test(wordText(w)) &&
      !/[\u0370-\u03ff\u{1d400}-\u{1d7ff}]/u.test(wordText(w)),
  );
  const lexical = new Map(
    words
      .filter((w) => /^[A-Za-z]{2,}$/.test(wordText(w).normalize("NFKC")))
      .flatMap((w) => w.map((g) => [g, w.length] as const)),
  );
  const rows: Row[] = [];
  for (const w of proseWords) {
    const g = w[0],
      r = bounds(w),
      prev = rows.at(-1);
    if (
      prev &&
      Math.abs(prev.baseline - baseline(g)) < size(g) * 0.18 &&
      Math.abs(prev.size - size(g)) < size(g) * 0.15 &&
      r[0] >= prev.rect[0] &&
      r[0] - prev.rect[2] < size(g) * 8
    ) {
      prev.words.push(w);
      prev.rect = bounds(prev.words.flat());
    } else
      rows.push({
        words: [w],
        baseline: baseline(g),
        size: size(g),
        rect: r,
        glyphs: [],
      });
  }
  // Single labels in drawings must not recruit mathematical plot labels.
  const substantial = (r: Row) =>
    r.words.length >= 3 && r.words.flat().length >= 14;
  const proseRows = rows.filter(
    (r, i) =>
      substantial(r) ||
      [rows[i - 1], rows[i + 1]].some(
        (other) =>
          other &&
          substantial(other) &&
          Math.abs(other.size - r.size) < r.size * 0.15 &&
          (Math.abs(other.rect[0] - r.rect[0]) < r.size * 1.5 ||
            (r.words.length >= 2 &&
              Math.abs(other.rect[2] - r.rect[2]) < r.size * 1.5)) &&
          Math.abs(other.baseline - r.baseline) > r.size * 0.8 &&
          Math.abs(other.baseline - r.baseline) < r.size * 1.65,
      ),
  );
  if (!proseRows.length) return glyphs;
  const rowOrder = new Map(
    proseRows.map((r) => [
      r,
      [
        Math.min(...r.words.flat().map((g) => positions.get(g)!)),
        Math.max(...r.words.flat().map((g) => positions.get(g)!)),
      ],
    ]),
  );
  for (const row of proseRows) {
    const [start, end] = rowOrder.get(row)!;
    const nearby = glyphs
      .slice(Math.max(0, start - 100), end + 101)
      .filter(
        (g) =>
          !g.rotation &&
          Math.abs(baseline(g) - row.baseline) < row.size * 0.2 &&
          size(g) >= row.size * 0.85,
      );
    for (let changed = true; changed; ) {
      changed = false;
      for (const g of nearby) {
        const dx = Math.max(
          row.rect[0] - g.rect[2],
          g.rect[0] - row.rect[2],
          0,
        );
        if (
          dx > row.size * 1.5 ||
          (g.rect[0] >= row.rect[0] && g.rect[2] <= row.rect[2])
        )
          continue;
        row.rect[0] = Math.min(row.rect[0], g.rect[0]);
        row.rect[2] = Math.max(row.rect[2], g.rect[2]);
        changed = true;
      }
    }
  }
  const ownership = new Map<Glyph, Row>();
  for (const g of glyphs) {
    if (g.rotation || g.inlineMath) continue;
    let chosen: Row | undefined,
      score = Infinity;
    for (const row of proseRows) {
      const [start, end] = rowOrder.get(row)!;
      const pos = positions.get(g)!;
      // A nearby line across a column gutter must not capture delayed scripts
      // from a different native paragraph hundreds of characters away.
      if (pos < start - 100 || pos > end + 100) continue;
      const dy = Math.abs(baseline(g) - row.baseline) / row.size;
      const dx =
        Math.max(row.rect[0] - g.rect[2], g.rect[0] - row.rect[2], 0) /
        row.size;
      if (dy > 0.7 || dx > 4 || size(g) > row.size * 1.5) continue;
      // Numerators near a wrapped line's left edge can be closer horizontally
      // to the previous line. Baseline proximity must decide ownership first.
      const candidate = dy + dx * 0.001;
      if (candidate < score) {
        chosen = row;
        score = candidate;
      }
    }
    if (chosen) {
      chosen.glyphs.push(g);
      ownership.set(g, chosen);
    }
  }
  const replacements = new Map<Glyph, Glyph[]>();
  const consumed = new Set<Glyph>();
  const repaired: { row: Row; output: Glyph[] }[] = [];
  for (const row of proseRows) {
    const gs = row.glyphs.sort(
      (a, b) => a.rect[0] - b.rect[0] || b.rect[1] - a.rect[1],
    );
    // Small caps and linked glossary terms are prose too. A short roman word
    // can be a script (e.g. int/max) only when its baseline is displaced.
    const prose = (g: Glyph) =>
      lexical.has(g) &&
      !(
        lexical.get(g)! <= 3 &&
        size(g) < row.size * 0.84 &&
        Math.abs(baseline(g) - row.baseline) > row.size * 0.2
      );
    const math = (g: Glyph) => {
      if (prose(g) || !g.text.trim()) return false;
      if (
        /[\u0370-\u03ff\ue000-\uf8ff\ufffd\u{1d400}-\u{1d7ff}=∝≈≠≤≥∂×⊗∥∑∫∈√+−*/′]/u.test(
          g.text,
        )
      )
        return true;
      if (/^[A-Za-z]$/.test(g.text) && g.italic && !/^[AIa]$/.test(g.text))
        return true;
      return /^[A-Za-z0-9]$/.test(g.text) && size(g) < row.size * 0.84;
    };
    const seeds = gs.filter(math);
    if (!seeds.length) continue;
    const groups: Glyph[][] = [];
    for (const g of seeds) {
      const prev = groups.at(-1),
        r = prev && bounds(prev);
      const between =
        r &&
        gs.some(
          (p) =>
            !math(p) &&
            p.text.trim() &&
            p.rect[0] >= r[2] - 0.05 &&
            p.rect[2] <= g.rect[0] + 0.05,
        );
      if (prev && r && !between && g.rect[0] - r[2] < row.size * 0.7)
        prev.push(g);
      else groups.push([g]);
    }
    for (const group of groups) {
      let rect = bounds(group);
      // Ordinary digits and short roman variables participate only inside a
      // connected math expression, never through an intervening prose word.
      for (let changed = true; changed; ) {
        changed = false;
        for (const g of gs) {
          if (
            group.includes(g) ||
            prose(g) ||
            !/^[A-Za-z0-9'()[\].-]+$/.test(g.text)
          )
            continue;
          const dx = Math.max(rect[0] - g.rect[2], g.rect[0] - rect[2], 0);
          if (dx > row.size * 0.18) continue;
          // Full-size sentence punctuation belongs to prose, not the image.
          const decimal =
            g.text === "." &&
            gs.some(
              (p) =>
                /^[0-9]$/.test(p.text) &&
                Math.abs(p.rect[2] - g.rect[0]) < row.size * 0.18,
            ) &&
            gs.some(
              (p) =>
                /^[0-9]$/.test(p.text) &&
                Math.abs(p.rect[0] - g.rect[2]) < row.size * 0.18,
            );
          if (
            /^[.()[\]]$/.test(g.text) &&
            size(g) >= row.size * 0.85 &&
            !decimal
          )
            continue;
          const joint = bounds([...group, g]);
          if (
            gs.some(
              (p) => prose(p) && p.rect[0] < joint[2] && p.rect[2] > joint[0],
            )
          )
            continue;
          group.push(g);
          rect = joint;
          changed = true;
        }
      }
    }
    // Growing a digit/script can connect two seeds. Resolve ownership before
    // creating images: a glyph must never belong to competing crops.
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; ) {
        const a = bounds(groups[i]),
          b = bounds(groups[j]);
        if (
          groups[i].some((g) => groups[j].includes(g)) ||
          Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.1
        ) {
          groups[i] = [...new Set([...groups[i], ...groups[j]])];
          groups.splice(j, 1);
          j = i + 1;
        } else j++;
      }
    }
    const atoms = new Map<Glyph, Glyph>();
    for (const group of groups) {
      const rect = bounds(group);
      // Punctuation already visible INSIDE the crop must not be emitted again
      // in text. Punctuation outside its bounds stays in the sentence.
      for (const g of gs) {
        const center = (g.rect[0] + g.rect[2]) / 2;
        if (
          !group.includes(g) &&
          !prose(g) &&
          center > rect[0] &&
          center < rect[2] &&
          /^[,.;:()[\]]$/.test(g.text)
        )
          group.push(g);
      }
      // A superscript citation is not an inline formula. A variable, operator,
      // or vertical fraction must support the crop.
      if (!group.some((g) => /[\p{L}\ue000-\uf8ff\ufffd=∝≈∂∑∫√]/u.test(g.text)))
        continue;
      if (
        rect[2] - rect[0] > row.size * 18 ||
        rect[3] - rect[1] > row.size * 2.6
      )
        continue;
      const first = group.reduce((a, b) => (a.index < b.index ? a : b));
      const crop = cropBounds(group);
      const id = `p${pageIndex}-inline-${first.index}`,
        token = `$BIREAD_MATH_${id}$`;
      const atom: Glyph = {
        ...first,
        text: token,
        fontSize: row.size,
        baseline: row.baseline,
        rect: [rect[0], row.rect[1], rect[2], row.rect[3]],
        lineBreakAfter: false,
        paragraphBreakAfter: false,
        spaceAfter: false,
        inlineMath: {
          id,
          token,
          rect: [
            crop[0] - 0.15,
            crop[1] - 0.15,
            crop[2] + 0.15,
            crop[3] + 0.15,
          ],
        },
      };
      for (const g of group) atoms.set(g, atom);
    }
    if (!atoms.size) continue;
    const output = [...new Set(gs.map((g) => atoms.get(g) || g))].sort(
      (a, b) => a.rect[0] - b.rect[0],
    );
    // Keep native order outside this line. No neighbouring-column glyph can
    // be silently moved through this replacement.
    const rowPositions = gs.map((g) => positions.get(g)!);
    const start = Math.min(...rowPositions),
      end = Math.max(...rowPositions);
    if (glyphs.slice(start, end + 1).some((g) => !gs.includes(g))) continue;
    const originalEnd = gs.reduce((a, b) => (a.rect[2] > b.rect[2] ? a : b));
    const endLine = originalEnd.lineBreakAfter,
      endParagraph = originalEnd.paragraphBreakAfter;
    for (let i = 0; i < output.length; i++) {
      const g = output[i],
        next = output[i + 1];
      if (next) {
        g.lineBreakAfter = false;
        g.paragraphBreakAfter = false;
        g.spaceAfter =
          !/^[,.;:!?)]/.test(next.text) &&
          (!!g.inlineMath ||
            !!next.inlineMath ||
            g.spaceAfter ||
            next.rect[0] - g.rect[2] > row.size * 0.1);
      } else {
        g.lineBreakAfter = endLine;
        g.paragraphBreakAfter = endParagraph;
        if (g.inlineMath) g.spaceAfter = true;
      }
    }
    replacements.set(glyphs[start], output);
    gs.forEach((g) => consumed.add(g));
    repaired.push({ row, output });
  }
  // Broken formula runs also invent a paragraph break at the physical line's
  // end. Clear it only for a flush-left, adjacent continuation in the same lane.
  for (const { row, output } of repaired) {
    const last = output.at(-1)!;
    const end = Math.max(...row.glyphs.map((g) => glyphs.indexOf(g)));
    const next = glyphs[end + 1];
    if (!next || next.rotation) continue;
    const nextRow = ownership.get(next);
    const drop = row.baseline - (nextRow?.baseline ?? baseline(next));
    const left = Math.min(...row.glyphs.map((g) => g.rect[0]));
    if (
      drop > row.size * 0.8 &&
      drop < row.size * 1.65 &&
      next.rect[0] <= left + row.size * 0.3 &&
      next.rect[0] >= left - row.size * 1.5 &&
      (!nextRow || Math.abs(nextRow.size - row.size) < row.size * 0.15) &&
      !next.bold &&
      !/^[•▪●]$/.test(next.text)
    )
      last.paragraphBreakAfter = false;
  }
  // A delayed script may also create a break BEFORE its physical line. The
  // preceding unmodified prose line can be joined only if it is unfinished,
  // unindented and immediately adjacent in the same column.
  for (const { row, output } of repaired) {
    const start = Math.min(...row.glyphs.map((g) => positions.get(g)!));
    const previous = glyphs[start - 1];
    const previousRow = previous && ownership.get(previous);
    if (!previousRow || previousRow === row) continue;
    const drop = previousRow.baseline - row.baseline;
    const left = Math.min(...row.glyphs.map((g) => g.rect[0]));
    const priorLeft = Math.min(...previousRow.glyphs.map((g) => g.rect[0]));
    if (
      drop > row.size * 0.8 &&
      drop < row.size * 1.65 &&
      Math.abs(previousRow.size - row.size) < row.size * 0.15 &&
      left <= priorLeft + row.size * 0.3 &&
      left >= priorLeft - row.size * 1.5 &&
      !/[.!?:;。！？：；]$/.test(previous.text) &&
      !output[0].bold &&
      !/^[•▪●]$/.test(output[0].text)
    ) {
      const prior =
        repaired.find((r) => r.row === previousRow)?.output.at(-1) || previous;
      prior.paragraphBreakAfter = false;
    }
  }
  return glyphs.flatMap(
    (g) => replacements.get(g) || (consumed.has(g) ? [] : [g]),
  );
}

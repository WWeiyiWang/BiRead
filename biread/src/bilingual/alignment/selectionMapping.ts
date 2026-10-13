import type { Block } from "../types";

export function alignmentContext(
  block: Block,
  side: "source" | "translation",
  start: number,
  end: number,
) {
  const text = side === "source" ? block.source : block.translation || "";
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > text.length ||
    end <= start
  )
    return;
  const units = block.segments.filter((s) => {
    const lo = side === "source" ? s.sourceStart : s.translationStart;
    const hi = side === "source" ? s.sourceEnd : s.translationEnd;
    return lo !== undefined && hi !== undefined && lo < end && hi > start;
  });
  if (units.length !== 1 || !block.translation) return;
  const unit = units[0];
  if (unit.translationStart === undefined || unit.translationEnd === undefined)
    return;
  return {
    source: block.source.slice(unit.sourceStart, unit.sourceEnd),
    translation: block.translation.slice(
      unit.translationStart,
      unit.translationEnd,
    ),
    side,
    selected: text.slice(start, end),
    selectionStart:
      start - (side === "source" ? unit.sourceStart : unit.translationStart),
    selectionEnd:
      end - (side === "source" ? unit.sourceStart : unit.translationStart),
  };
}

export function contextualRange(
  block: Block,
  side: "source" | "translation",
  start: number,
  end: number,
  raw: string,
) {
  try {
    const result = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
    if (
      result.confident !== true ||
      typeof result.quote !== "string" ||
      !result.quote.trim()
    )
      return;
    return (side === "source" ? preciseSourceRange : preciseTranslationRange)(
      block,
      start,
      end,
      [result.quote],
    );
  } catch {
    return;
  }
}

/** Only accept a unique, whole-word phrase inside the aligned sentence. */
export function preciseTranslationRange(
  block: Block,
  start: number,
  end: number,
  candidates: string[],
): [number, number] | undefined {
  if (
    !block.translation ||
    start < 0 ||
    end > block.translation.length ||
    end <= start
  )
    return;
  const units = block.segments.filter(
    (s) =>
      s.translationStart !== undefined &&
      s.translationEnd !== undefined &&
      s.translationStart < end &&
      s.translationEnd > start,
  );
  if (units.length !== 1) return;
  const unit = units[0];
  // An explicitly selected complete sentence still uses its established alignment.
  if (
    block.translation
      .slice(unit.translationStart, unit.translationEnd)
      .trim() === block.translation.slice(start, end).trim()
  )
    return [unit.sourceStart, unit.sourceEnd];
  const matches = new Map<string, [number, number]>();
  for (const candidate of candidates) {
    const words = candidate.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const pattern = words
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const re = new RegExp(pattern, "giu");
    const source = block.source.slice(unit.sourceStart, unit.sourceEnd);
    for (const m of source.matchAll(re)) {
      const lo = m.index!;
      const hi = lo + m[0].length;
      if (
        (/[a-z0-9_]/i.test(m[0][0]) &&
          /[a-z0-9_]/i.test(source[lo - 1] || "")) ||
        (/[a-z0-9_]/i.test(m[0].slice(-1)) &&
          /[a-z0-9_]/i.test(source[hi] || ""))
      )
        continue;
      // A partial translated selection must never silently become a whole sentence.
      if (
        source.slice(0, lo).trim() === "" &&
        /^[\s.!?。！？]*$/.test(source.slice(hi)) &&
        block.translation
          .slice(unit.translationStart, unit.translationEnd)
          .trim() !== block.translation.slice(start, end).trim()
      )
        continue;
      const span: [number, number] = [
        unit.sourceStart + lo,
        unit.sourceStart + hi,
      ];
      matches.set(span.join(":"), span);
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined;
}

export function preciseSourceRange(
  block: Block,
  start: number,
  end: number,
  candidates: string[],
): [number, number] | undefined {
  if (!block.translation) return;
  // Reuse the same bounded matching with the two texts and sentence offsets swapped.
  return preciseTranslationRange(
    {
      ...block,
      source: block.translation,
      translation: block.source,
      segments: block.segments
        .filter(
          (s) =>
            s.translationStart !== undefined && s.translationEnd !== undefined,
        )
        .map((s) => ({
          ...s,
          sourceStart: s.translationStart!,
          sourceEnd: s.translationEnd!,
          translationStart: s.sourceStart,
          translationEnd: s.sourceEnd,
        })),
    },
    start,
    end,
    candidates,
  );
}

/** Translation APIs expose stable sentence IDs but no word timing data. */
export function mapRange(
  block: Block,
  side: "source" | "translation",
  start: number,
  end: number,
): [number, number] | undefined {
  if (start < 0 || end <= start) return;
  const units = block.segments.filter((segment) => {
    const lo =
      side === "source" ? segment.sourceStart : segment.translationStart;
    const hi = side === "source" ? segment.sourceEnd : segment.translationEnd;
    return lo !== undefined && hi !== undefined && lo < end && hi > start;
  });
  if (!units.length) return;
  if (side === "translation")
    return [units[0].sourceStart, units[units.length - 1].sourceEnd];
  const first = units[0].translationStart;
  const last = units[units.length - 1].translationEnd;
  if (first !== undefined && last !== undefined) return [first, last];
}

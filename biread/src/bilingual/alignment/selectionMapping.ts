import type { Block } from "../types";

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

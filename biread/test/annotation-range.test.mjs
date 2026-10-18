import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({
  entryPoints: ["src/bilingual/alignment/annotationRange.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { alignedSelectionRange } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
function block(pairs) {
  let source = "",
    translation = "";
  const segments = pairs.map(([s, t]) => {
    const unit = {
      sourceStart: source.length,
      translationStart: translation.length,
    };
    source += s;
    translation += t;
    return {
      ...unit,
      sourceEnd: source.length,
      translationEnd: translation.length,
    };
  });
  return { source, translation, segments };
}
test("long paragraphs align only the selected sentence in both directions", async () => {
  const b = block(
    Array.from({ length: 80 }, (_, i) => [
      `Sentence ${i} retains collective memory. `,
      `第${i}句保存集体记忆。`,
    ]),
  );
  const unit = b.segments[65];
  for (const side of ["source", "translation"]) {
    let calls = 0;
    const start =
      side === "source"
        ? b.source.indexOf("collective memory", unit.sourceStart)
        : b.translation.indexOf("集体记忆", unit.translationStart);
    const end = start + (side === "source" ? 17 : 4);
    const result = await alignedSelectionRange(
      b,
      side,
      start,
      end,
      async (s, t, direction, lo, hi) => {
        calls++;
        assert.equal(s, b.source.slice(unit.sourceStart, unit.sourceEnd));
        assert.equal(
          t,
          b.translation.slice(unit.translationStart, unit.translationEnd),
        );
        assert.equal(
          (direction === "source" ? s : t).slice(lo, hi),
          side === "source" ? "collective memory" : "集体记忆",
        );
        return direction === "source"
          ? [t.indexOf("集体记忆"), t.indexOf("集体记忆") + 4]
          : [
              s.indexOf("collective memory"),
              s.indexOf("collective memory") + 17,
            ];
      },
    );
    assert.equal(calls, 1);
    assert.equal(
      b[side === "source" ? "translation" : "source"].slice(...result),
      side === "source" ? "集体记忆" : "collective memory",
    );
  }
});
test("multi-sentence selection uses established translation IDs without a model", async () => {
  const b = block([
    ["One. ", "一。"],
    ["Two. ", "二。"],
    ["Three.", "三。"],
  ]);
  assert.deepEqual(
    await alignedSelectionRange(b, "translation", 0, 4, () => {
      throw Error("unnecessary model");
    }),
    [0, 10],
  );
});
test("formula IDs do not pollute inference or shift UTF-16 offsets", async () => {
  const token = "$BIREAD_MATH_inline-p10-g30$";
  const b = block([
    [`🧪 ${token} preserves energy.`, `🧪 ${token} 保持能量。`],
  ]);
  const start = b.translation.indexOf("能量");
  const result = await alignedSelectionRange(
    b,
    "translation",
    start,
    start + 2,
    async (s, t, side, lo, hi) => {
      assert.equal(t.slice(lo, hi), "能量");
      assert.equal(s.length, b.source.length);
      assert.ok(!s.includes("BIREAD"));
      return [s.indexOf("energy"), s.indexOf("energy") + 6];
    },
  );
  assert.equal(b.source.slice(...result), "energy");
});
test("missing alignment or a failed partial sentence cannot create a partial PDF mark", async () => {
  const b = block([
    ["One. ", "一。"],
    ["Two words.", "第二句话。"],
  ]);
  assert.equal(
    await alignedSelectionRange(b, "translation", 0, 5, async () => undefined),
    undefined,
  );
  b.segments = [];
  assert.equal(await alignedSelectionRange(b, "translation", 0, 2), undefined);
});

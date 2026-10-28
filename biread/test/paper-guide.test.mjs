import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({
  entryPoints: ["src/bilingual/translation/paperGuide.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { validateGuide, guideBatches, buildPaperGuide } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const blocks = [
  {
    id: "a",
    kind: "paragraph",
    source: "At 20 C the force was 3.5 N with sample A.",
    pageIndex: 2,
    pageLabel: "465",
  },
  {
    id: "b",
    kind: "paragraph",
    source: "The method uses a spring under controlled humidity.",
    pageIndex: 3,
    pageLabel: "466",
  },
];
const claim = {
  kind: "result",
  text: "力为 3.5 N。",
  conditions: "20 C，sample A",
  evidence: [
    { blockId: "a", quote: blocks[0].source },
    { blockId: "b", quote: blocks[1].source },
  ],
};
const check = (c) => validateGuide(JSON.stringify({ claims: [c] }), blocks);
test("multiple exact sources retained; page metadata is not trusted from model", () => {
  assert.equal(
    check({ ...claim, pageLabel: "999" }).claims[0].evidence.length,
    2,
  );
  assert.equal(
    check({ ...claim, pageLabel: "999" }).claims[0].pageLabel,
    undefined,
  );
});
test("unknown source, fabricated quote, changed numbers and missing conditions rejected", () => {
  for (const c of [
    { ...claim, evidence: [{ blockId: "fake", quote: blocks[0].source }] },
    {
      ...claim,
      evidence: [
        { blockId: "a", quote: "This fabricated quotation does not exist." },
      ],
    },
    { ...claim, text: "力为 35 N" },
    { ...claim, conditions: "" },
  ])
    assert.equal(check(c).rejected, 1);
});
test("AI explanation remains explicitly separate; malformed fields rejected", () => {
  assert.equal(
    check({ ...claim, kind: "interpretation" }).claims[0].kind,
    "interpretation",
  );
  assert.equal(check({ ...claim, kind: "invented" }).rejected, 1);
  assert.equal(check({ ...claim, text: 42 }).rejected, 1);
});
test("all source text covered without reference/furniture contamination", () => {
  const batches = guideBatches(
    [...blocks, { id: "ref", kind: "reference", source: "excluded" }],
    20,
  );
  assert.equal(
    batches
      .flat()
      .map((b) => b.source)
      .join(""),
    blocks.map((b) => b.source).join(""),
  );
  assert.ok(
    batches.every((b) => b.reduce((n, x) => n + x.source.length, 0) <= 20),
  );
});
test("cancelled requests cannot return a finished guide", async () => {
  let cancelled = false;
  await assert.rejects(
    buildPaperGuide(
      blocks,
      async () => {
        cancelled = true;
        return JSON.stringify({ claims: [claim] });
      },
      () => {},
      () => cancelled,
    ),
    /取消/,
  );
});
test("provider failure propagates instead of producing a partial successful guide", async () => {
  await assert.rejects(
    buildPaperGuide(
      blocks,
      async () => {
        throw new Error("offline");
      },
      () => {},
      () => false,
    ),
    /offline/,
  );
});
test("successful guide reports checked content and progress", async () => {
  const progress = [];
  const guide = await buildPaperGuide(
    blocks,
    async () => JSON.stringify({ claims: [claim] }),
    (d, t) => progress.push([d, t]),
    () => false,
  );
  assert.equal(guide.claims.length, 1);
  assert.deepEqual(progress.at(-1), [1, 1]);
});

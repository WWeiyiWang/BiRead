import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({
  entryPoints: ["src/bilingual/parser/modelLayout.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { applyModelLayout } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const box = [0, 0, 600, 800];
const block = (id, kind, source, rect) => ({
  id,
  kind,
  source,
  pageIndex: 0,
  pageLabel: "1",
  pageHeight: 800,
  segments: [],
  anchors: [
    { start: 0, end: source.length, pageIndex: 0, charIndex: Number(id), rect },
  ],
});
test("visual paragraph reunites fragments preserving annotation offsets", () => {
  const a = block("1", "paragraph", "This leads to", [20, 500, 200, 520]);
  const b = block(
    "2",
    "paragraph",
    "x = 2 under condition A.",
    [20, 480, 200, 498],
  );
  const result = applyModelLayout(
    [a, b],
    [{ label: "plain text", confidence: 0.95, rect: [18, 478, 202, 522] }],
    box,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "This leads to x = 2 under condition A.");
  assert.equal(result[0].anchors[1].start, a.source.length + 1);
  assert.equal(result[0].layoutRole, "prose");
});

test("tall matrix brackets belong to the formula despite font descent beyond its detected ink", () => {
  const formula = block("1", "paragraph", "A = 0 1", [100, 100, 180, 128]);
  const bracket = block("2", "paragraph", "]", [181, 121, 185, 131]);
  const result = applyModelLayout(
    [formula, bracket],
    [{ label: "isolate_formula", confidence: 0.95, rect: [99, 99, 186, 127] }],
    box,
    "regions",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "equation");
  assert.equal(result[0].originalRegion.rect[3], 131);
});

test("explicit caption anchor corroborates a wrapped caption without consuming outside prose", () => {
  const a = block("1", "caption", "Fig. 1. Measurements.", [20, 300, 240, 315]);
  const b = block(
    "2",
    "paragraph",
    "a, Sample preparation. b, Experimental results.",
    [20, 280, 240, 299],
  );
  const outside = block(
    "3",
    "paragraph",
    "Next body paragraph.",
    [20, 230, 240, 250],
  );
  const result = applyModelLayout(
    [a, b, outside],
    [{ label: "figure_caption", confidence: 0.65, rect: [18, 278, 242, 317] }],
    box,
    "regions",
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, "caption");
  assert.match(result[0].source, /Experimental results/);
  assert.equal(result[1].source, outside.source);
});
test("whole figure excludes internal labels but retains translated caption", () => {
  const label = block("1", "paragraph", "Tail 1", [40, 400, 70, 410]);
  const caption = block(
    "2",
    "caption",
    "Fig. 3. Full panel explanation.",
    [20, 280, 250, 310],
  );
  const result = applyModelLayout(
    [label, caption],
    [{ label: "figure", confidence: 0.96, rect: [20, 320, 550, 650] }],
    box,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "caption");
  assert.deepEqual(result[0].originalRegion.rect, [20, 320, 550, 650]);
});
test("uncertain model regions do not discard content", () => {
  const a = block("1", "paragraph", "Useful prose", [30, 350, 200, 370]);
  assert.deepEqual(
    applyModelLayout(
      [a],
      [{ label: "figure", confidence: 0.5, rect: [20, 320, 550, 650] }],
      box,
    ),
    [a],
  );
});
test("numbered sections inside an overlarge text detection are not merged", () => {
  const heading = block("1", "heading", "2.1 Results", [20, 500, 200, 520]);
  const p = block(
    "2",
    "paragraph",
    "Our measurements show a result.",
    [20, 480, 200, 498],
  );
  assert.equal(
    applyModelLayout(
      [heading, p],
      [{ label: "plain text", confidence: 0.96, rect: [18, 478, 202, 522] }],
      box,
    ).length,
    2,
  );
});

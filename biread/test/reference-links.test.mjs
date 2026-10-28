import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({
  entryPoints: ["src/bilingual/parser/referenceLinks.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { attachReferenceLinks } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const source = () => ({
  id: "p",
  pageIndex: 0,
  kind: "paragraph",
  source: "See [12].",
  anchors: [{ start: 4, end: 8, rect: [10, 10, 30, 20] }],
});
test("citation retains label, exact destination and reference preview", () => {
  const b = source(),
    ref = {
      id: "r",
      pageIndex: 1,
      kind: "reference",
      source: "12. Author. Title.",
      anchors: [{ rect: [40, 80, 200, 100] }],
    };
  attachReferenceLinks(
    [b, ref],
    [[{ rect: [10, 10, 30, 20], targetPageIndex: 1, targetPoint: [40, 100] }]],
  );
  assert.equal(b.links[0].label, "[12]");
  assert.equal(b.links[0].targetBlockID, "r");
  assert.equal(b.links[0].preview, ref.source);
});
test("unsafe actions are excluded and duplicate links collapse", () => {
  const b = source(),
    rect = [10, 10, 30, 20];
  attachReferenceLinks(
    [b],
    [
      [
        { rect, url: "javascript:alert(1)" },
        { rect, url: "https://doi.org/example" },
        { rect, url: "https://doi.org/example" },
      ],
    ],
  );
  assert.equal(b.links.length, 1);
  assert.equal(b.links[0].url, "https://doi.org/example");
});
test("ambiguous reference page does not fabricate a preview", () => {
  const b = source();
  attachReferenceLinks(
    [
      b,
      ...["a", "b"].map((id) => ({
        id,
        pageIndex: 1,
        kind: "reference",
        source: id,
        anchors: [],
      })),
    ],
    [[{ rect: [10, 10, 30, 20], targetPageIndex: 1 }]],
  );
  assert.equal(b.links[0].preview, undefined);
  assert.equal(b.links[0].targetPageIndex, 1);
});

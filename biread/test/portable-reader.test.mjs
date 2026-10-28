import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({
  entryPoints: ["src/bilingual/ui/portableReader.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { portableReader } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const block = (id, kind, source, extra = {}) => ({
  id,
  kind,
  source,
  pageIndex: 0,
  pageLabel: "1",
  anchors: [],
  segments: [],
  ...extra,
});
test("document text cannot inject executable markup or image URLs", () => {
  const html = portableReader(
    [
      block("x", "title", "</script><script>alert(1)</script>"),
      block("y", "caption", "Figure 1"),
    ],
    [{ id: "im", captionID: "y", src: "https://evil.test/tracker.png" }],
  );
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("https://evil.test"));
  assert.ok(html.includes("connect-src 'none'"));
});
test("inline math stays in the paragraph and missing equations never show corrupted text", () => {
  const html = portableReader(
    [
      block("p", "paragraph", "Force $BIREAD_MATH_a$ acts.", {
        translation: "力 $BIREAD_MATH_a$ 起作用。",
        inlineMath: [{ id: "m", token: "$BIREAD_MATH_a$" }],
      }),
      block("eq", "equation", "CORRUPTED GLYPHS"),
    ],
    [{ id: "im", captionID: "m", src: "data:image/png;base64,AAAA" }],
  );
  assert.ok(html.includes('力 <img class="math"'));
  assert.ok(!html.includes("$BIREAD_MATH_"));
  assert.ok(!html.includes("CORRUPTED GLYPHS"));
  assert.ok(html.includes("原文区域尚未加载"));
});
test("guide and outline link to stable source blocks, with no fabricated summary", () => {
  const html = portableReader(
    [
      block("a", "abstract", "Exact 3.5 mg under condition A"),
      block("h", "heading", "2.1 Results", { headingLevel: 2 }),
      block("r", "reference", "Author, Journal"),
    ],
    [],
  );
  assert.ok(html.includes('href="#b0"'));
  assert.ok(html.includes("margin-left:1em"));
  assert.ok(html.includes("Exact 3.5 mg under condition A"));
  assert.ok(html.includes("不是 AI 总结"));
  assert.ok(html.includes("Reference"));
});

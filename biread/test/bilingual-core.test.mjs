import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "zpt-bilingual-test-"));
const output = join(dir, "core.mjs");
await build({
  stdin: {
    contents: [
      'export * from "./src/bilingual/reader/figurePreviews";',
      'export * from "./src/bilingual/ui/figureController";',
      'export * from "./src/bilingual/parser/originalRegions";',
      'export * from "./src/bilingual/parser/layoutQuality";',
      'export * from "./src/bilingual/parser/embedInlineMath";',
      'export * from "./src/bilingual/parser/pageContinuations";',
      'export * from "./src/bilingual/alignment/segmentAlignment";',
      'export * from "./src/bilingual/alignment/selectionMapping";',
      'export * from "./src/bilingual/parser/blockSegmenter";',
      'export * from "./src/bilingual/parser/readingOrder";',
      'export * from "./src/bilingual/parser/documentStructure";',
      'export * from "./src/bilingual/parser/pdfImages";',
      'export * from "./src/bilingual/parser/figureRegions";',
      'export * from "./src/bilingual/parser/textTables";',
      'export * from "./src/bilingual/annotations/annotationMapping";',
      'export * from "./src/bilingual/glossary/documentGlossary";',
      'export * from "./src/bilingual/cache/translationCache";',
      'export * from "./src/bilingual/cache/documentCache";',
      'export * from "./src/bilingual/types";',
      'export * from "./src/bilingual/translation/textProtection";',
      'export * from "./src/bilingual/translation/requestDeadline";',
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
});
const core = await import(pathToFileURL(output));
await rm(dir, { recursive: true, force: true });

test("measurement at wrapped line start stays prose while section numbers remain headings", () => {
  const lines = [
    "The forces decrease to",
    "0.09 N at state I and state II, respectively. For the prestrech of",
    "2.6. Energy Characterization",
  ];
  const glyphs = lines.map((text, index) => ({
    text,
    index,
    rect: [40, 500 - index * 15, 280, 510 - index * 15],
    fontSize: 10,
    lineBreakAfter: true,
    paragraphBreakAfter: index === 1,
  }));
  const blocks = core.segmentPage(glyphs, 3, "4", 800, { active: false });
  core.inferHierarchy(blocks);
  assert.ok(
    blocks.find((b) => b.source.includes("0.09 N")).kind === "paragraph",
  );
  assert.equal(blocks.find((b) => b.source.startsWith("2.6.")).kind, "heading");
});

test("author affiliations are distinct from prose and rotated 3D text is not a footnote", () => {
  const blocks = [
    { ...block("Paper title"), kind: "title" },
    {
      ...block("Dinesh K. Patel, Xiaonan Huang, Yichi Luo, Lining Yao"),
      kind: "heading",
    },
    block(
      "D. K. Patel, L. Yao Human-Computer Interaction Institute Carnegie Mellon University Pittsburgh, PA 15213, USA E-mail: author@example.org",
    ),
    block("We studied university buildings and their effects on people."),
  ];
  core.identifyFrontMatter(blocks);
  assert.equal(blocks[1].kind, "author-info");
  assert.equal(blocks[2].kind, "author-info");
  assert.equal(blocks[3].kind, "paragraph");
  const glyphs = Array.from({ length: 10 }, (_, i) => ({
    text: "Body prose",
    index: i,
    rect: [40, 400 + i * 12, 250, 410 + i * 12],
    fontSize: 10,
    lineBreakAfter: true,
  }));
  glyphs.push({
    text: "3D printing +",
    index: 10,
    rect: [400, 60, 408, 130],
    fontSize: 7,
    rotation: 90,
    lineBreakAfter: true,
  });
  assert.equal(
    core.separateFootnotes({ glyphs, box: [0, 0, 600, 800] }).notes.length,
    0,
  );
});

test("headingless bibliography includes continuation blocks but not inline citations", () => {
  const texts = [
    "We compare methods [1], [2] and [3].",
    "[1] H.-T. Lin, G. Leisk, Journal 2011, 6,",
    "026007. [2] B. Lindqvist, Robotics 2022.",
    "[3] Z. Wu, Mechatronics 2017.",
    "More journal details.",
  ];
  const blocks = texts.map((t, i) => ({
    ...block(t),
    id: String(i),
    kind: "paragraph",
    pageIndex: i === 0 ? 0 : 9,
  }));
  core.identifyReferences(blocks);
  assert.equal(blocks[0].kind, "paragraph");
  assert.ok(blocks.slice(1).every((b) => b.kind === "reference"));
});

test("Patel formula left-hand glyph and rotated table follow native PDF coordinates", () => {
  const make = (id, source, kind, rect, rotation = 0) => ({
    id,
    source,
    kind,
    rotation,
    fontSize: 9.215,
    pageIndex: 0,
    pageLabel: "1",
    segments: [],
    anchors: [
      { start: 0, end: source.length, charIndex: 0, pageIndex: 0, rect },
    ],
  });
  const formula = make(
    "eq",
    "θ λ = θ λ + θ (1)",
    "equation",
    [66.50986, 672.0405, 289.129, 680.9775],
  );
  const letters = make(
    "letters",
    "UU U",
    "paragraph",
    [47.0275, 672.3735, 162.8935, 680.6175],
  );
  const result = core.preserveOriginalRegions(
    [letters, formula],
    [],
    [0, 0, 600, 800],
  );
  assert.equal(result.length, 1);
  assert.ok(formula.originalRegion.rect[0] < 47.0275);
  const caption = make(
    "table",
    "Table 1. Comparison of soft bistable actuators.",
    "caption",
    [303.899, 66.5918, 311.347, 223.1918],
    90,
  );
  const cells = [
    make("a", "Voltage", "paragraph", [330, 640, 337, 670], 90),
    make("b", "Pneumatic 0.09 0.04", "paragraph", [352, 66, 359, 709], 90),
    make("c", "Not provided", "paragraph", [400, 300, 407, 350], 90),
    make("d", "3D printing + SMA", "footnote", [530, 66, 540, 130], 90),
  ];
  const prose = make(
    "body",
    "Adjacent body text",
    "paragraph",
    [40, 80, 290, 710],
  );
  const tableResult = core.preserveOriginalRegions(
    [prose, caption, ...cells],
    [],
    [0, 0, 600, 800],
  );
  assert.deepEqual(tableResult, [prose, caption]);
  assert.ok(caption.originalRegion.rect[3] >= 709);
  assert.ok(caption.originalRegion.rect[2] >= 540);
});

test("original formula absorbs nearby fragments but not prose", () => {
  const make = (id, source, kind, rect) => ({
    id,
    source,
    kind,
    pageIndex: 0,
    pageLabel: "1",
    fontSize: 10,
    segments: [],
    anchors: [
      { start: 0, end: source.length, charIndex: 0, pageIndex: 0, rect },
    ],
  });
  const eq = make("eq", "= 0 (2)", "equation", [40, 400, 240, 410]);
  const sub = make("sub", "total", "paragraph", [48, 412, 65, 418]);
  const prose = make(
    "p",
    "The result of this analytic model is shown below.",
    "paragraph",
    [40, 360, 240, 380],
  );
  const result = core.preserveOriginalRegions(
    [sub, eq, prose],
    [],
    [0, 0, 600, 800],
  );
  assert.equal(result.length, 2);
  assert.ok(result.includes(prose));
  assert.ok(eq.originalRegion.rect[3] >= 421);
  assert.equal(eq.anchors.length, 2);
});

test("original structured table removes cell reflow and preserves caption", () => {
  const caption = block("Table 1. Results");
  caption.kind = "caption";
  const cell = block("Not provided");
  cell.id = "cell";
  cell.kind = "table-cell";
  cell.table = { captionID: caption.id, rect: [40, 200, 300, 400] };
  cell.anchors.forEach((a) => (a.rect = [50, 250, 100, 260]));
  const result = core.preserveOriginalRegions(
    [caption, cell],
    [],
    [0, 0, 600, 800],
  );
  assert.deepEqual(result, [caption]);
  assert.equal(caption.originalRegion.kind, "table");
});

test("Chinese word alignment follows meaning rather than relative position", () => {
  const b = block(
    "By building upon the tradition of archives as repositories of collective memory.",
  );
  b.translation = "通过建立档案作为集体记忆存储库的传统。";
  Object.assign(b.segments[0], {
    translationStart: 0,
    translationEnd: b.translation.length,
  });
  const start = b.translation.indexOf("传统");
  const span = core.preciseTranslationRange(b, start, start + 2, ["tradition"]);
  assert.equal(b.source.slice(...span), "tradition");
  assert.equal(
    core.preciseTranslationRange(b, start, start + 2, [b.source]),
    undefined,
  );
  assert.equal(
    core.preciseTranslationRange(b, start, start + 2, ["unknown"]),
    undefined,
  );
});

test("word alignment rejects ambiguity and partial English words", () => {
  const b = block("Art and artificial art support collective memory.");
  b.translation = "艺术支持集体记忆。";
  Object.assign(b.segments[0], {
    translationStart: 0,
    translationEnd: b.translation.length,
  });
  assert.equal(core.preciseTranslationRange(b, 0, 2, ["art"]), undefined);
  assert.equal(core.preciseTranslationRange(b, 0, 2, ["arti"]), undefined);
  const span = core.preciseTranslationRange(b, 4, 8, ["collective memory"]);
  assert.equal(b.source.slice(...span), "collective memory");
});

function block(source = "First claim. Second claim.") {
  return {
    id: "p0-c0",
    kind: "paragraph",
    pageIndex: 0,
    pageLabel: "1",
    pageHeight: 800,
    source,
    segments: core.segmentText(source, "p0-c0"),
    anchors: [...source].map((text, i) => ({
      start: i,
      end: i + 1,
      pageIndex: 0,
      charIndex: i,
      rect: [i * 5, 700, i * 5 + 5, 710],
    })),
  };
}

test("inline Abstract labels split from prose without changing PDF anchors", () => {
  for (const label of ["Abstract", "Abstract:", "ABSTRACT"]) {
    const text = `${label} Throughout history, cultures have evolved.`;
    const glyphs = [...text].map((text, index) => ({
      text,
      index,
      fontSize: 10,
      bold: index < label.length,
      rect: [index * 5, 700, index * 5 + 5, 710],
    }));
    const snapshot = structuredClone(glyphs);
    const blocks = core.segmentPage(glyphs, 0, "301", 800, { active: false });
    core.inferHierarchy(blocks);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].kind, "heading");
    assert.equal(blocks[0].headingLevel, 1);
    assert.equal(blocks[0].source, label);
    assert.equal(
      blocks[1].source,
      "Throughout history, cultures have evolved.",
    );
    assert.equal(blocks[1].anchors[0].charIndex, label.length + 1);
    assert.equal(blocks[1].anchors[0].start, 0);
    assert.deepEqual(glyphs, snapshot);
  }
});

test("standalone Abstract stays a heading before a short body line", () => {
  const chars = [
    {
      u: "Abstract",
      rect: [0, 700, 80, 716],
      fontSize: 16,
      lineBreakAfter: true,
    },
    { u: "A short opening sentence.", rect: [0, 680, 150, 690], fontSize: 10 },
  ];
  const blocks = core.segmentPage(core.readingOrder(chars), 0, "1", 800, {
    active: false,
  });
  core.inferHierarchy(blocks);
  assert.equal(blocks[0].source, "Abstract");
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[1].source, "A short opening sentence.");
});

test("ordinary prose beginning Abstract concepts is not split as a heading", () => {
  const glyphs = [..."Abstract concepts can be difficult."].map(
    (text, index) => ({
      text,
      index,
      fontSize: 10,
      rect: [index * 5, 700, index * 5 + 5, 710],
    }),
  );
  const blocks = core.segmentPage(glyphs, 2, "3", 800, { active: false });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].source, "Abstract concepts can be difficult.");
});

test("document cache rejects old segmentation and accepts current parser revision", async () => {
  const names = ["Zotero", "PathUtils", "IOUtils", "_globalThis"];
  const previous = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  const cached = {
    version: 1,
    identity: "paper",
    fingerprint: "fp",
    blocks: [],
  };
  try {
    globalThis.Zotero = { DataDirectory: { dir: "/test" } };
    globalThis.PathUtils = { join };
    globalThis.IOUtils = {
      exists: async () => true,
      readJSON: async () => cached,
    };
    globalThis._globalThis = { crypto: globalThis.crypto, TextEncoder };
    assert.equal(await core.loadDocument("paper", "fp"), undefined);
    cached.parserVersion = core.DOCUMENT_PARSER_VERSION;
    assert.equal(await core.loadDocument("paper", "fp"), cached);
  } finally {
    names.forEach((name, i) => {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]);
      else delete globalThis[name];
    });
  }
});
test("structured two-column reading order is retained, including positional identity", () => {
  const chars = [
    { u: "Left first.", rect: [10, 700, 90, 710], paragraphBreakAfter: true },
    { u: "Left second.", rect: [10, 650, 90, 660], paragraphBreakAfter: true },
    {
      u: "Right first.",
      rect: [310, 700, 390, 710],
      paragraphBreakAfter: true,
    },
  ];
  const blocks = core.segmentPage(core.readingOrder(chars), 2, "iii", 800, {
    active: false,
  });
  assert.deepEqual(
    blocks.map((b) => b.source),
    chars.map((c) => c.u),
  );
  assert.equal(blocks[2].anchors[0].charIndex, 2);
  assert.equal(blocks[2].pageLabel, "iii");
});
test("references and equations are excluded from translation by classification", () => {
  const state = { active: false };
  const glyph = (text) => [
    { text, rect: [0, 0, 100, 10], index: 0, paragraphBreakAfter: true },
  ];
  assert.equal(
    core.segmentPage(glyph("x = y + z"), 0, "1", 800, state)[0].kind,
    "equation",
  );
  core.segmentPage(glyph("References"), 1, "2", 800, state);
  assert.equal(
    core.segmentPage(
      glyph("Smith (2024). A title. https://example.org"),
      2,
      "3",
      800,
      state,
    )[0].kind,
    "reference",
  );
});
test("ID reordering is restored, missing and duplicate IDs fail without partial mutation", () => {
  const b = block();
  core.applyTranslations(b, [
    { id: b.segments[1].id, translation: "第二个观点。" },
    { id: b.segments[0].id, translation: "第一个观点。" },
  ]);
  assert.equal(b.translation, "第一个观点。第二个观点。");
  assert.deepEqual(core.mapRange(b, "translation", 1, 3), [
    0,
    b.segments[0].sourceEnd,
  ]);
  const firstTranslation = b.segments[0].translation;
  const selectedWord = firstTranslation.indexOf("个观点") + 1;
  const wordRange = core.mapRange(
    b,
    "translation",
    selectedWord,
    selectedWord + 2,
  );
  assert.deepEqual(wordRange, [0, b.segments[0].sourceEnd]);
  const previous = b.translation;
  assert.throws(() =>
    core.applyTranslations(b, [{ id: b.segments[0].id, translation: "错误" }]),
  );
  assert.equal(b.translation, previous);
  assert.throws(() =>
    core.applyTranslations(b, [
      { id: b.segments[0].id, translation: "甲" },
      { id: b.segments[0].id, translation: "乙" },
    ]),
  );
});
test("canonical coordinate mapping finds correct occurrence of repeated text", () => {
  const b = block("Repeat. Repeat.");
  core.applyTranslations(
    b,
    b.segments.map((s, i) => ({
      id: s.id,
      translation: i ? "第二次。" : "第一次。",
    })),
  );
  const mappings = core.annotationMappings(b, [
    {
      key: "ABC12345",
      color: "#ff6666",
      comment: "Canonical comment",
      position: { pageIndex: 0, rects: [[40, 700, 75, 710]] },
    },
  ]);
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].translation.text, "第二次。");
  assert.equal(mappings[0].zoteroAnnotationKey, "ABC12345");
  assert.equal(mappings[0].color, "#ff6666");
  assert.equal(mappings[0].comment, "Canonical comment");
  assert.deepEqual(core.annotationMappings(b, []), []);
});
test("next-page annotations and exact reverse metadata fall back after translation changes", () => {
  const b = block("Some source.");
  b.pageIndex = 1;
  core.applyTranslations(b, [
    { id: b.segments[0].id, translation: "一段译文。" },
  ]);
  const a = {
    key: "ABC12345",
    color: "#ffd400",
    comment: "",
    position: { pageIndex: 0, rects: [], nextPageRects: [[0, 700, 60, 710]] },
  };
  const exact = [
    {
      key: a.key,
      blockID: b.id,
      source: b.source,
      translation: b.translation,
      start: 1,
      end: 3,
      position: JSON.stringify(a.position),
    },
  ];
  assert.equal(
    core.annotationMappings(b, [a], exact)[0].translation.text,
    "段译",
  );
  b.translation = "新的完整译文。";
  b.segments[0].translationEnd = b.translation.length;
  assert.equal(
    core.annotationMappings(b, [a], exact)[0].translation.text,
    b.translation,
  );
});
test("source rectangles merge only along the same line, never across columns", () => {
  const b = block("ABC");
  b.anchors[2].rect = [300, 700, 305, 710];
  assert.deepEqual(core.sourceRects(b, 0, 3), [
    [0, 700, 10, 710],
    [300, 700, 305, 710],
  ]);
});
test("glossary validation and relevant subset permit targeted invalidation", () => {
  const g = core.parseGlossary(
    "embodiment → 具身性\nspatial memory => 空间记忆",
  );
  assert.deepEqual(core.relevantGlossary("Embodiment is discussed.", g), {
    embodiment: "具身性",
  });
  assert.throws(() => core.parseGlossary("not a mapping"));
});
test("cache identity includes model/source/provider/mode and relevant glossary version", async () => {
  globalThis._globalThis = { crypto: globalThis.crypto, TextEncoder };
  const ctx = {
    provider: "chatgpt",
    model: "model-a",
    endpoint: "https://example.org",
    mode: "academic",
    glossary: { embodiment: "具身性" },
  };
  const b = block("Embodiment matters.");
  const key = await new core.TranslationCache("1-ITEMKEY", ctx).key(b);
  for (const change of [
    { model: "model-b" },
    { provider: "claude" },
    { mode: "standard" },
    { glossary: { embodiment: "具身化" } },
  ]) {
    assert.notEqual(
      await new core.TranslationCache("1-ITEMKEY", { ...ctx, ...change }).key(
        b,
      ),
      key,
    );
  }
  assert.equal(
    await new core.TranslationCache("1-ITEMKEY", {
      ...ctx,
      glossary: { ...ctx.glossary, affordance: "可供性" },
    }).key(b),
    key,
  );
  assert.notEqual(
    await new core.TranslationCache("2-ITEMKEY", ctx).key(b),
    key,
  );
});

test("citations and formulas survive translation byte-for-byte; omissions fail", () => {
  const source =
    "Prior work (Smith et al., 2024) [12–14] uses $x+y$; see https://example.org/paper.";
  const protectedText = core.protectText(source);
  assert.equal(protectedText.restore(protectedText.text), source);
  assert.throws(() => protectedText.restore("译文省略了引文"));
  const tokens = protectedText.text.match(/⟦ZPT_KEEP_\d+⟧/g);
  assert.throws(() => protectedText.restore(protectedText.text + tokens[0]));
});

test("PDF font changes separate title from authors and preserve exact anchors", () => {
  const chars = [
    {
      u: "Paper Title",
      rect: [0, 700, 100, 718],
      fontSize: 18,
      bold: true,
      lineBreakAfter: true,
    },
    {
      u: "Alice Smith",
      rect: [0, 680, 100, 690],
      fontSize: 10,
      paragraphBreakAfter: true,
    },
    {
      u: "1 Introduction",
      rect: [0, 650, 100, 662],
      fontSize: 12,
      bold: true,
      paragraphBreakAfter: true,
    },
    {
      u: "1.1 Prior Work",
      rect: [0, 620, 100, 630],
      fontSize: 10,
      bold: true,
      paragraphBreakAfter: true,
    },
    {
      u: "1.1.1 Details",
      rect: [0, 600, 100, 610],
      fontSize: 10,
      bold: true,
      paragraphBreakAfter: true,
    },
    {
      u: "An ordinary short line",
      rect: [0, 580, 100, 590],
      fontSize: 10,
      paragraphBreakAfter: true,
    },
    {
      u: "This is body text. ".repeat(20),
      rect: [0, 550, 100, 560],
      fontSize: 10,
      paragraphBreakAfter: true,
    },
  ];
  const blocks = core.segmentPage(core.readingOrder(chars), 0, "1", 800, {
    active: false,
  });
  core.inferHierarchy(blocks);
  assert.equal(blocks[0].kind, "title");
  assert.equal(blocks[1].source, "Alice Smith");
  assert.equal(blocks[1].anchors[0].charIndex, 1);
  assert.equal(blocks[1].anchors[0].start, 0);
  assert.deepEqual(
    blocks.slice(2, 5).map((b) => b.headingLevel),
    [1, 2, 3],
  );
  assert.equal(blocks[5].kind, "paragraph");
});
test("ordinary translation can keep citations locally without exposing mask tokens", () => {
  const source = "Prior work (Smith, 2024) [12] uses $x+y$.";
  const parts = core.protectText(source).parts;
  assert.equal(parts.map((p) => p.text).join(""), source);
  assert.deepEqual(
    parts.filter((p) => p.protected).map((p) => p.text),
    ["(Smith, 2024)", "[12]", "$x+y$"],
  );
  assert.ok(parts.every((p) => !p.text.includes("ZPT_KEEP")));
});

test("a silent provider times out and a completed request clears its deadline", async () => {
  await assert.rejects(
    core.requestDeadline(new Promise(() => {}), () => new Error("timeout"), 5),
    /timeout/,
  );
  assert.equal(
    await core.requestDeadline(
      Promise.resolve("translated"),
      () => new Error("timeout"),
      5,
    ),
    "translated",
  );
});

test("embedded image placements preserve nested form transforms and repeats", () => {
  const list = {
    fnArray: [10, 12, 85, 74, 85, 75, 88, 11, 85],
    argsArray: [
      [],
      [100, 0, 0, 50, 20, 30],
      ["first"],
      [[1, 0, 0, 1, 2, 3]],
      ["nested"],
      [],
      ["repeat", 0.5, 0.5, [0, 0, 1, 0]],
      [],
      ["tiny"],
    ],
  };
  const images = core.imagePlacements(list);
  assert.equal(images.length, 4);
  assert.deepEqual(images[0].rect, [20, 30, 120, 80]);
  assert.deepEqual(images[1].rect, [220, 180, 320, 230]);
  assert.deepEqual(images[3].rect, [120, 30, 170, 55]);
});
test("RGB, RGBA, and packed monochrome pixels decode without page rasterization", () => {
  assert.deepEqual(
    [
      ...core.rgbaPixels({
        width: 1,
        height: 1,
        kind: 2,
        data: new Uint8Array([10, 20, 30]),
      }),
    ],
    [10, 20, 30, 255],
  );
  assert.deepEqual(
    [
      ...core.rgbaPixels({
        width: 1,
        height: 1,
        kind: 3,
        data: new Uint8Array([10, 20, 30, 40]),
      }),
    ],
    [10, 20, 30, 40],
  );
  assert.deepEqual(
    [
      ...core.rgbaPixels({
        width: 1,
        height: 2,
        kind: 1,
        data: new Uint8Array([128, 0]),
      }),
    ],
    [255, 255, 255, 255, 0, 0, 0, 255],
  );
  assert.throws(() =>
    core.rgbaPixels({
      width: 10,
      height: 10,
      kind: 2,
      data: new Uint8Array(3),
    }),
  );
});
test("figure crop follows caption graphics and excludes prose and page backgrounds", () => {
  const caption = {
    ...block("Figure 1: Example"),
    id: "caption",
    kind: "caption",
    anchors: [{ rect: [40, 390, 280, 410] }],
  };
  const other = {
    ...block("Body prose ".repeat(30)),
    anchors: [{ rect: [40, 600, 280, 650] }],
  };
  const graphics = [
    [0, 0, 600, 800],
    [50, 435, 130, 520],
    [140, 435, 240, 520],
    [320, 440, 550, 600],
  ];
  const crop = core.figureRegion(
    caption,
    graphics,
    [0, 0, 600, 800],
    [caption, other],
  );
  assert.deepEqual(crop, [40, 423, 250, 524]);
  assert.equal(
    core.figureRegion(caption, [], [0, 0, 600, 800], [caption]),
    undefined,
  );
  assert.equal(
    core.imageAnchor({ pageIndex: 0, rect: [50, 430, 240, 530] }, [
      other,
      caption,
    ]).id,
    "caption",
  );
});

test("repeated running furniture and page numbers are removed, body and footnotes remain", () => {
  const pages = Array.from({ length: 6 }, (_, p) => ({
    box: [0, 0, 600, 800],
    glyphs: [
      {
        text: p % 2 ? "Journal of Testing" : "Running paper title",
        index: 0,
        rect: [40, 766, 260, 778],
        lineBreakAfter: true,
      },
      {
        text: "Section " + p,
        index: 1,
        rect: [40, 720, 200, 735],
        lineBreakAfter: true,
      },
      {
        text: "Body paragraph",
        index: 2,
        rect: [40, 680, 280, 694],
        paragraphBreakAfter: true,
      },
      {
        text: "1 A unique footnote on page " + p,
        index: 3,
        rect: [40, 25, 350, 35],
        paragraphBreakAfter: true,
      },
      {
        text: String(p + 1),
        index: 4,
        rect: [290, 10, 305, 20],
        paragraphBreakAfter: true,
      },
    ],
  }));
  const cleaned = core.removePageFurniture(pages);
  for (const page of cleaned)
    assert.deepEqual(
      page.glyphs.map((g) => g.index),
      [1, 2, 3],
    );
  assert.equal(
    pages[0].glyphs.length,
    5,
    "source coordinates/data remain intact",
  );
});
test("single-page margins keep prose and isolated headings while omitting a page number", () => {
  const pages = [
    {
      box: [0, 100, 600, 900],
      glyphs: [
        {
          text: "Important heading",
          index: 0,
          rect: [40, 860, 300, 880],
          paragraphBreakAfter: true,
        },
        {
          text: "A real footnote.",
          index: 1,
          rect: [40, 112, 300, 125],
          paragraphBreakAfter: true,
        },
        {
          text: "7",
          index: 2,
          rect: [290, 105, 300, 112],
          paragraphBreakAfter: true,
        },
      ],
    },
  ];
  assert.deepEqual(
    core.removePageFurniture(pages)[0].glyphs.map((g) => g.index),
    [0, 1],
  );
});
test("list items split within a native paragraph and do not become chapter headings", () => {
  const chars = [
    {
      u: "1 Introduction",
      rect: [40, 700, 200, 712],
      lineBreakAfter: true,
      paragraphBreakAfter: true,
      fontSize: 12,
    },
    {
      u: "1. First item.",
      rect: [40, 650, 200, 660],
      lineBreakAfter: true,
      fontSize: 10,
    },
    {
      u: "Continuation of the first item.",
      rect: [50, 638, 240, 648],
      lineBreakAfter: true,
      fontSize: 10,
    },
    {
      u: "2. Second item.",
      rect: [40, 625, 210, 635],
      paragraphBreakAfter: true,
      fontSize: 10,
    },
    {
      u: "1.1 Methods",
      rect: [40, 590, 200, 600],
      paragraphBreakAfter: true,
      fontSize: 10,
    },
    {
      u: "Body paragraph. ".repeat(20),
      rect: [40, 550, 260, 560],
      paragraphBreakAfter: true,
      fontSize: 10,
    },
  ];
  const blocks = core.segmentPage(core.readingOrder(chars), 1, "2", 800, {
    active: false,
  });
  core.inferHierarchy(blocks);
  core.assignSections(blocks);
  assert.equal(blocks[1].kind, "list");
  assert.ok(blocks[1].source.includes("Continuation"));
  assert.equal(blocks[2].kind, "list");
  assert.equal(blocks[1].sectionID, blocks[0].id);
  assert.deepEqual(blocks[4].sectionPath, ["1 Introduction", "1.1 Methods"]);
  assert.equal(blocks[2].anchors[0].charIndex, 3);
});

test("wrapped footnote continuations survive repetition at the bottom margin", () => {
  const pages = Array.from({ length: 4 }, (_, p) => ({
    box: [0, 0, 600, 800],
    glyphs: [
      {
        text: "1 Footnote begins here " + p,
        index: 0,
        rect: [40, 55, 300, 66],
        lineBreakAfter: true,
      },
      {
        text: "the repeated continuation is still a footnote.",
        index: 1,
        rect: [40, 30, 320, 42],
        paragraphBreakAfter: true,
      },
      {
        text: String(p + 1),
        index: 2,
        rect: [290, 10, 300, 20],
        paragraphBreakAfter: true,
      },
    ],
  }));
  for (const page of core.removePageFurniture(pages))
    assert.deepEqual(
      page.glyphs.map((g) => g.index),
      [0, 1],
    );
});
test("small diagram labels cannot become appendix headings", () => {
  const body = { ...block("Body text. ".repeat(30)), fontSize: 11 };
  const label = { ...block("C T1 T[SEP]"), fontSize: 4 };
  core.inferHierarchy([body, label]);
  assert.equal(label.kind, "paragraph");
});

test("a larger real title survives even when repeated in a running header", () => {
  const pages = Array.from({ length: 5 }, (_, p) => ({
    box: [0, 0, 600, 800],
    glyphs: [
      {
        text: "The same paper title",
        index: 0,
        fontSize: p ? 10 : 18,
        rect: [40, 766, 280, 780],
        paragraphBreakAfter: true,
      },
    ],
  }));
  const result = core.removePageFurniture(pages);
  assert.equal(result[0].glyphs.length, 1);
  assert.ok(result.slice(1).every((p) => p.glyphs.length === 0));
});

test("top-caption table selects below-caption grid without swallowing a second figure", () => {
  const caption = {
    ...block("TABLE 1 Counts"),
    id: "table",
    kind: "caption",
    anchors: [{ rect: [40, 650, 550, 670] }],
  };
  const note = {
    ...block("Total viewers denotes unique viewers. ".repeat(5)),
    id: "note",
    anchors: [{ rect: [40, 470, 550, 498] }],
  };
  const next = {
    ...block("Figure 2 Heatmap"),
    id: "next",
    kind: "caption",
    anchors: [{ rect: [40, 280, 550, 300] }],
  };
  const graphics = [
    [40, 580, 550, 635],
    [40, 520, 550, 580],
    [40, 520, 550, 635],
    [40, 325, 550, 450],
  ];
  const region = core.figureRegion(
    caption,
    graphics,
    [0, 0, 600, 800],
    [caption, note, next],
  );
  assert.ok(region);
  assert.ok(region[3] < 650);
  assert.ok(region[1] > 498);
  const cells = {
    ...block("A 304 299"),
    id: "cells",
    anchors: [{ rect: [40, 525, 540, 560] }],
  };
  assert.deepEqual(
    core
      .tableTextBlocks(caption.id, 0, region, [caption, cells, note])
      .map((b) => b.id),
    ["cells"],
  );
});
test("tables with bottom captions and figures with top captions both retain previews", () => {
  const caption = {
    ...block("Table 2 Results"),
    kind: "caption",
    anchors: [{ rect: [40, 300, 500, 315] }],
  };
  assert.ok(
    core.figureRegion(
      caption,
      [[40, 330, 500, 430]],
      [0, 0, 600, 800],
      [caption],
    ),
  );
  caption.source = "Figure 3 Model";
  caption.anchors = [{ rect: [40, 450, 500, 465] }];
  const region = core.figureRegion(
    caption,
    [[40, 330, 500, 430]],
    [0, 0, 600, 800],
    [caption],
  );
  assert.ok(region);
  assert.ok(region[3] < 450);
});
test("explicit MT terminology matches whole terms, prefers longest, keeps other words", () => {
  const parts = core.glossaryParts(
    "Urban public space and space-time in spacecraft.",
    { "public space": "公共空间", space: "空间" },
  );
  assert.equal(
    parts.map((p) => p.text).join(""),
    "Urban 公共空间 and 空间-time in spacecraft.",
  );
  assert.deepEqual(
    parts.filter((p) => p.protected).map((p) => p.text),
    ["公共空间", "空间"],
  );
});

test("duplicate media placements are compared geometrically, not by image identity", () => {
  assert.equal(core.sameRegion([10, 10, 210, 110], [8, 8, 212, 112]), true);
  assert.equal(core.sameRegion([10, 10, 210, 110], [10, 130, 210, 230]), false);
  assert.equal(core.sameRegion([10, 10, 210, 110], [20, 20, 50, 50]), false);
});
test("text table rule run includes tall rows and stops before the next section", () => {
  const c = block("Table 1. Conditions");
  c.kind = "caption";
  c.anchors = [
    {
      start: 0,
      end: 18,
      pageIndex: 0,
      charIndex: 0,
      rect: [10, 310, 310, 320],
    },
  ];
  const heading = {
    ...block("Next section"),
    id: "next",
    kind: "heading",
    anchors: [
      {
        start: 0,
        end: 12,
        pageIndex: 0,
        charIndex: 100,
        rect: [10, 80, 250, 90],
      },
    ],
  };
  const graphics = [300, 280, 240, 190, 140, 100, 60, 40].map((y) => [
    10,
    y,
    310,
    y,
  ]);
  assert.deepEqual(
    core.textTableRegion(c, graphics, [c, heading]),
    [10, 100, 310, 300],
  );
});

test("context alignment uses existing translations for proper names and rejects invented quotes", () => {
  const b = block(
    "Spore Stepper is a modified walking stick for collecting soil samples.",
  );
  core.applyTranslations(b, [
    {
      id: b.segments[0].id,
      translation: "孢子步进器是一种改良的手杖，用于采集土壤样本。",
    },
  ]);
  const context = core.alignmentContext(b, "source", 0, 13);
  assert.equal(context.selected, "Spore Stepper");
  assert.equal(context.translation, b.translation);
  let span = core.contextualRange(
    b,
    "source",
    0,
    13,
    JSON.stringify({ quote: "孢子步进器", confident: true }),
  );
  assert.equal(b.translation.slice(...span), "孢子步进器");
  span = core.contextualRange(
    b,
    "translation",
    0,
    5,
    JSON.stringify({ quote: "Spore Stepper", confident: true }),
  );
  assert.equal(b.source.slice(...span), "Spore Stepper");
  assert.equal(
    core.contextualRange(
      b,
      "source",
      0,
      13,
      JSON.stringify({ quote: "孢子行走装置", confident: true }),
    ),
    undefined,
  );
  assert.equal(
    core.contextualRange(
      b,
      "source",
      0,
      13,
      JSON.stringify({ quote: b.translation, confident: true }),
    ),
    undefined,
  );
  assert.equal(core.contextualRange(b, "source", 0, 13, "not JSON"), undefined);
  assert.equal(core.alignmentContext(b, "source", -1, 13), undefined);
});

test("a complete translated segment cannot expand into multiple source sentences", () => {
  const source =
    "This research addresses the gap. The methodology uses a review. Subsequently, an experiment was conducted.";
  const translation = "本研究旨在弥合这一空白。";
  const b = {
    source,
    translation,
    segments: [
      {
        sourceStart: 0,
        sourceEnd: source.length,
        translationStart: 0,
        translationEnd: translation.length,
      },
    ],
  };
  assert.equal(
    core.preciseTranslationRange(b, 0, translation.length, []),
    undefined,
  );
});

test("italic font-run breaks merge only on the same baseline", () => {
  const glyphs = core.readingOrder([
    {
      u: "Reading",
      rect: [0, 500, 40, 510],
      fontSize: 10,
      paragraphBreakAfter: true,
    },
    {
      u: "Book Title",
      rect: [44, 500, 90, 510],
      fontSize: 10,
      italic: true,
      paragraphBreakAfter: true,
    },
    {
      u: "is useful.",
      rect: [94, 500, 140, 510],
      fontSize: 10,
      paragraphBreakAfter: true,
    },
    { u: "Another paragraph.", rect: [0, 475, 100, 485], fontSize: 10 },
  ]);
  const blocks = core.segmentPage(glyphs, 0, "1", 800, { active: false });
  assert.equal(blocks[0].source, "Reading Book Title is useful.");
  assert.equal(blocks[1].source, "Another paragraph.");
  assert.equal(blocks[0].anchors[1].charIndex, 1);
});

test("standalone margin DOI is hidden but prose DOI and numbered notes survive", () => {
  const line = (text, index, y, size = 10) => ({
    text,
    index,
    rect: [40, y, 300, y + size],
    fontSize: size,
    lineBreakAfter: true,
  });
  const page = {
    box: [0, 0, 600, 800],
    glyphs: [
      line("Body discussion of doi:10.1234/example.", 0, 500),
      line("1 This is an explanatory footnote.", 1, 60, 8),
      line("doi:10.1234/example", 2, 25, 8),
    ],
  };
  const clean = core.removePageFurniture([page])[0];
  assert.deepEqual(
    clean.glyphs.map((g) => g.index),
    [0, 1],
  );
});

test("footnote streams retain their anchors and do not interrupt body", () => {
  const line = (text, index, y, size = 10) => ({
    text,
    index,
    rect: [40, y, 300, y + size],
    fontSize: size,
    lineBreakAfter: true,
  });
  const page = {
    box: [0, 0, 600, 800],
    glyphs: [
      line("Long body line.", 0, 500),
      line("More body text.", 1, 485),
      line("Still body text.", 2, 470),
      line("1 Explanatory note", 3, 90, 8),
      line("continued here.", 4, 78, 8),
    ],
  };
  const result = core.separateFootnotes(page);
  assert.deepEqual(
    result.body.map((g) => g.index),
    [0, 1, 2],
  );
  assert.deepEqual(
    result.notes.map((g) => g.index),
    [3, 4],
  );
});

test("dotted contents entries keep their own page numbers", () => {
  const lines = ["Introduction ........ 12", "Methods ........ 25"];
  const glyphs = lines.map((text, index) => ({
    text,
    index,
    rect: [40, 500 - index * 15, 400, 510 - index * 15],
    fontSize: 10,
    lineBreakAfter: true,
  }));
  const blocks = core.segmentPage(glyphs, 0, "1", 800, { active: false });
  assert.deepEqual(
    blocks.map((b) => b.source),
    lines,
  );
});

test("corresponding-author footnotes remain while publisher footer identifiers are hidden", () => {
  const line = (text, index, y, size = 10) => ({
    text,
    index,
    rect: [40, y, 300, y + size],
    fontSize: size,
    lineBreakAfter: true,
  });
  const page = {
    box: [0, 0, 600, 800],
    glyphs: [
      line("Body text one", 0, 500),
      line("Body text two", 1, 480),
      line("Body text three", 2, 460),
      line("Body text four", 3, 440),
      line("Body text five", 4, 420),
      line("*Corresponding author. Present address: France.", 5, 90, 8),
      line("Tel.: +33-1-6985-8014", 6, 80, 8),
      line("E-mail address: author@example.org", 7, 70, 8),
      line(
        "0926-6410/01/$ – see front matter © 2001 Elsevier. All rights reserved.",
        8,
        30,
        8,
      ),
      line("PII: S0926-6410(01)00013-1", 9, 20, 8),
    ],
  };
  const clean = core.removePageFurniture([page])[0];
  const split = core.separateFootnotes(clean);
  assert.deepEqual(
    split.notes.map((g) => g.index),
    [5, 6, 7],
  );
  assert.deepEqual(
    split.body.map((g) => g.index),
    [0, 1, 2, 3, 4],
  );
});

test("cross-page continuation keeps coordinates and rejects authored new paragraphs", () => {
  const a = block("The study examines the");
  const b = block("effects of immersion.");
  a.fontSize = b.fontSize = 10;
  a.anchors.forEach((x) => (x.rect = [40, 60, 250, 70]));
  b.pageIndex = 1;
  b.id = "p1-c0";
  b.anchors.forEach((x) => {
    x.pageIndex = 1;
    x.rect = [40, 720, 250, 730];
  });
  assert.equal(core.pageContinuations([a, b]).length, 1);
  assert.equal(b.anchors[0].pageIndex, 1);
  a.source = "The study ends here.";
  assert.equal(core.pageContinuations([a, b]).length, 0);
  a.source = "The study examines the";
  b.kind = "heading";
  assert.equal(core.pageContinuations([a, b]).length, 0);
});

test("column jumps split independent layout regions", () => {
  const glyphs = [
    {
      text: "Left column text",
      index: 0,
      rect: [40, 500, 240, 510],
      fontSize: 10,
      lineBreakAfter: true,
    },
    {
      text: "Right column text",
      index: 1,
      rect: [320, 500, 520, 510],
      fontSize: 10,
      lineBreakAfter: true,
    },
  ];
  assert.equal(
    core.segmentPage(glyphs, 0, "1", 800, { active: false }).length,
    2,
  );
});

test("right column widening beneath abstract uses separate rectangles", () => {
  const glyphs = [
    {
      text: "narrow upper column continues",
      index: 0,
      rect: [400, 500, 550, 510],
      fontSize: 10,
      lineBreakAfter: true,
    },
    {
      text: "into a wider lower column.",
      index: 1,
      rect: [320, 480, 550, 490],
      fontSize: 10,
      lineBreakAfter: true,
    },
  ];
  const blocks = core.segmentPage(glyphs, 0, "1", 800, { active: false });
  assert.equal(blocks.length, 2);
  assert.equal(Math.min(...blocks[0].anchors.map((a) => a.rect[0])), 400);
  assert.equal(Math.min(...blocks[1].anchors.map((a) => a.rect[0])), 320);
});

test("long publisher download notice at side is furniture, prose is retained", () => {
  const text =
    "2365709x, 0, Downloaded from https://onlinelibrary.wiley.com/doi/10.1002/admt.202201259 by CAPES, Wiley Online Library on [26/11/2022]. See the Terms and Conditions for rules of use; OA articles are governed by the applicable Creative Commons License";
  const page = {
    box: [0, 0, 600, 800],
    glyphs: [
      {
        text,
        index: 0,
        rect: [580, 30, 590, 770],
        fontSize: 8,
        lineBreakAfter: true,
      },
      {
        text: "We discuss the terms and conditions in this study.",
        index: 1,
        rect: [40, 400, 550, 410],
        fontSize: 10,
        lineBreakAfter: true,
      },
    ],
  };
  assert.deepEqual(
    core.removePageFurniture([page])[0].glyphs.map((g) => g.index),
    [1],
  );
});

test("numbered formula is isolated from adjacent prose", () => {
  const glyphs = [
    {
      text: "The total energy is",
      index: 0,
      rect: [40, 500, 240, 510],
      fontSize: 10,
      lineBreakAfter: true,
    },
    {
      text: "Utotal = Umembrane + Uframe (1)",
      index: 1,
      rect: [40, 480, 240, 490],
      fontSize: 10,
      lineBreakAfter: true,
    },
    {
      text: "where the parameters represent energy.",
      index: 2,
      rect: [40, 460, 240, 470],
      fontSize: 10,
      lineBreakAfter: true,
    },
  ];
  const blocks = core.segmentPage(glyphs, 0, "1", 800, { active: false });
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].kind, "equation");
});

test("figure labels stay in original graphic while caption and outside prose survive", () => {
  const make = (id, source, kind, rect) => ({
    id,
    source,
    kind,
    pageIndex: 0,
    anchors: [
      { start: 0, end: source.length, charIndex: 0, pageIndex: 0, rect },
    ],
    segments: [],
  });
  const caption = make(
    "cap",
    "Fig. 1 | Seed carrier",
    "caption",
    [40, 80, 550, 90],
  );
  const label = make("label", "Flat-sawn", "paragraph", [80, 200, 140, 210]);
  const legend = make(
    "legend",
    "Natural seeds Engineered seed carriers",
    "paragraph",
    [90, 180, 300, 190],
  );
  const prose = make(
    "body",
    "The processing steps are described below.",
    "paragraph",
    [40, 40, 550, 60],
  );
  const result = core.preserveOriginalRegions(
    [label, legend, caption, prose],
    [[40, 100, 550, 500]],
    [0, 0, 600, 800],
  );
  assert.deepEqual(result, [caption, prose]);
  assert.equal(caption.originalRegion.kind, "figure");
  assert.ok(caption.originalRegion.rect[3] >= 500);
});

test("proportional numbered equation preserves superscript and subscript runs", () => {
  const glyphs = [
    {
      text: "K ∝ Ebh κ /l (1)",
      index: 0,
      rect: [135, 540, 295, 549],
      fontSize: 8,
      paragraphBreakAfter: true,
    },
    {
      text: "3",
      index: 16,
      rect: [170, 548, 174, 552],
      fontSize: 5,
      paragraphBreakAfter: true,
    },
    {
      text: "c 2",
      index: 17,
      rect: [190, 539, 196, 551],
      fontSize: 5,
      paragraphBreakAfter: true,
    },
  ];
  const blocks = core.segmentPage(glyphs, 2, "465", 800, { active: false });
  const result = core.preserveOriginalRegions(blocks, [], [0, 0, 600, 800]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "equation");
  assert.ok(result[0].originalRegion.rect[3] >= 555);
});

test("fragmented small-type caption is copied with its figure without swallowing body", () => {
  const make = (id, source, kind, rect, fontSize) => ({
    id,
    source,
    kind,
    fontSize,
    pageIndex: 0,
    segments: [],
    anchors: [
      { start: 0, end: source.length, charIndex: 0, pageIndex: 0, rect },
    ],
  });
  const caption = make(
    "cap",
    "Fig. 2 | Curvature",
    "caption",
    [40, 175, 290, 235],
    7,
  );
  const sub = make("sub", "YY 12", "paragraph", [260, 175, 290, 181], 5);
  const tail = make(
    "tail",
    "followed by a stiffening region",
    "paragraph",
    [40, 137, 290, 175],
    7,
  );
  const right = make(
    "right",
    "bending samples. Data are means",
    "paragraph",
    [306, 137, 557, 235],
    7,
  );
  const body = make(
    "body",
    "The topology of the design",
    "paragraph",
    [40, 45, 295, 100],
    8.25,
  );
  const result = core.preserveOriginalRegions(
    [caption, sub, tail, right, body],
    [[40, 238, 560, 740]],
    [0, 0, 600, 800],
  );
  assert.deepEqual(result, [caption, body]);
  assert.equal(caption.originalRegion.includesCaption, true);
  assert.ok(caption.source.includes("followed by a stiffening region"));
  assert.ok(caption.source.includes("bending samples"));
  assert.ok(caption.segments.length > 0);
  assert.ok(caption.originalRegion.rect[1] <= 137);
});

test("Nature numbered references merge continuations before Methods and supplements", () => {
  const texts = [
    "Conclusion",
    "1. Fisher, K. A. A study",
    "Journal 10 (2011).",
    "2. Ball, B. C. Another study (1986).",
    "3. Kelly, L. T. Study (2020).",
    "Publisher’s note Neutrality.",
    "Methods",
    "Fabrication details.",
    "Supplementary material",
  ];
  const blocks = texts.map((source, i) => ({
    ...block(source),
    id: String(i),
    kind: "paragraph",
    pageIndex: i < 6 ? 6 : 8,
  }));
  blocks.push({ ...block("Extended data"), pageIndex: 22 });
  core.identifyReferences(blocks);
  const first = blocks.find((b) => b.source.startsWith("1."));
  assert.equal(first.kind, "reference");
  assert.ok(first.source.endsWith("Journal 10 (2011)."));
  assert.equal(blocks.find((b) => b.source === "Methods").kind, "paragraph");
  assert.equal(
    blocks.find((b) => b.source.startsWith("Publisher")).kind,
    "paragraph",
  );
  assert.equal(blocks.filter((b) => b.kind === "reference").length, 3);
});

test("inline fraction scripts copy as one region and retain adjacent prose", () => {
  const make = (id, source, rects) => ({
    ...block(source),
    id,
    kind: "paragraph",
    pageIndex: 2,
    anchors: [...source].map((c, i) => ({
      start: i,
      end: i + 1,
      charIndex: Number(id) * 100 + i,
      pageIndex: 2,
      rect: rects[i] || [500 + i * 4, 389, 504 + i * 4, 397],
    })),
  });
  const k = make("1", "κ", [[437, 386, 440, 392]]);
  const h = make("2", "hh′", [
    [455, 394, 459, 400],
    [454, 386, 458, 392],
    [458, 386, 460, 392],
  ]);
  const d = make("3", "d", [[441, 393, 444, 398]]);
  const tail = make("4", "w, in which h is thickness", [[441, 385, 445, 390]]);
  const result = core.preserveOriginalRegions(
    [k, h, d, tail],
    [],
    [0, 0, 600, 800],
  );
  assert.equal(result.filter((b) => b.kind === "equation").length, 1);
  assert.equal(result.filter((b) => b.kind === "paragraph").length, 1);
  assert.equal(tail.source, ", in which h is thickness");
  assert.ok(k.originalRegion.rect[0] <= 437 && k.originalRegion.rect[2] >= 460);
  assert.ok(!result.some((b) => b.source === "d" || b.source === "hh′"));
});

test("inline original math remains inside prose and survives translation protection", () => {
  const make = (id, source, rect) => ({
    ...block(source),
    id,
    kind: "paragraph",
    pageIndex: 0,
    anchors: [
      { start: 0, end: source.length, charIndex: 0, pageIndex: 0, rect },
    ],
  });
  const before = make("before", "The curvature is", [10, 100, 80, 110]);
  const math = {
    ...make("math", "κ h", [82, 99, 100, 112]),
    kind: "equation",
    originalRegion: { kind: "equation", rect: [82, 99, 100, 112] },
  };
  const after = make("after", ", where h is thickness.", [102, 100, 180, 110]);
  const result = core.embedInlineMath([before, math, after]);
  assert.equal(result.length, 1);
  assert.equal(result[0].inlineMath.length, 1);
  assert.ok(result[0].source.endsWith(after.source));
  const protectedText = core.protectText(result[0].source);
  assert.equal(protectedText.restore(protectedText.text), result[0].source);
  assert.equal(
    result[0].anchors[1].start,
    result[0].source.indexOf(after.source),
  );
});

test("two-column author cards are metadata, not section headings or body", () => {
  const make = (id, source, kind, y) => ({
    ...block(source),
    id,
    kind,
    pageIndex: 0,
    anchors: [
      {
        start: 0,
        end: source.length,
        charIndex: 0,
        pageIndex: 0,
        rect: [80, y, 250, y + 10],
      },
    ],
  });
  const blocks = [
    make("t", "A Computational Framework", "title", 700),
    make("n", "Jeremy Chen", "heading", 650),
    make("d", "Mechanical Engineering, Morphing Matter Lab", "paragraph", 630),
    make("u", "University of California, Berkeley", "paragraph", 610),
    make("e", "Berkeley, USA author@example.edu", "paragraph", 590),
    make("a", "Abstract", "heading", 400),
    make("p", "We study mechanical engineering design.", "paragraph", 380),
  ];
  core.identifyFrontMatter(blocks);
  assert.deepEqual(
    blocks.slice(1, 5).map((b) => b.kind),
    Array(4).fill("author-info"),
  );
  assert.equal(blocks[6].kind, "paragraph");
});

test("private-font matrix fragments stay one inline object alongside prose", () => {
  const make = (id, source, rect) => ({
    ...block(source),
    id,
    kind: "paragraph",
    pageIndex: 0,
    anchors: [
      {
        start: 0,
        end: source.length,
        charIndex: Number(id) * 100,
        pageIndex: 0,
        rect,
      },
    ],
  });
  const blocks = [
    make("0", "The rest shape is", [100, 140, 200, 150]),
    make("1", "𝜆²", [202, 140, 220, 150]),
    make("2", "\ue012cos 𝜃 sin 𝜃", [222, 137, 248, 158]),
    make("3", "\ue013𝑇", [250, 150, 256, 159]),
    make("4", ", where the tensor is defined.", [258, 140, 350, 150]),
  ];
  const result = core.preserveOriginalRegions(blocks, [], [0, 0, 600, 800]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "paragraph");
  assert.equal(result[0].inlineMath.length, 1);
  assert.ok(!/[\ue000-\uf8ff]/.test(result[0].source));
  assert.ok(result[0].source.endsWith("where the tensor is defined."));
});

test("quality gate rejects unreadable text and fragmented math without sending garbage to translation", () => {
  const b = [{ ...block("\ue012cos θ"), kind: "paragraph", anchors: [] }];
  assert.ok(
    core
      .auditLayout(
        [{ text: "x", index: 0, rect: [0, 0, 2, 2] }],
        b,
        [0, 0, 600, 800],
      )
      .includes("unreadable-glyphs"),
  );
  assert.ok(
    core
      .auditLayout(
        [{ text: "x", index: 0, rect: [0, 0, 2, 2] }],
        [
          { ...block("κ"), kind: "paragraph" },
          { ...block("sin θ"), kind: "paragraph" },
        ],
        [0, 0, 600, 800],
      )
      .includes("fragmented-math"),
  );
  const fallback = core.originalPage(
    2,
    "465",
    [0, 0, 600, 800],
    ["fragmented-math"],
  );
  assert.equal(fallback.kind, "original-page");
  assert.equal(fallback.source, "");
  assert.equal(fallback.segments.length, 0);
  assert.deepEqual(fallback.originalRegion.rect, [0, 0, 600, 800]);
});
test("quality gate accounts for original-region and inline-image glyph coverage", () => {
  const glyphs = Array.from({ length: 12 }, (_, i) => ({
    text: "x",
    index: i,
    rect: [i * 3, 10, i * 3 + 2, 20],
  }));
  assert.ok(
    core.auditLayout(glyphs, [], [0, 0, 600, 800]).includes("missing-text"),
  );
  const preserved = {
    ...block(""),
    kind: "equation",
    anchors: [],
    originalRegion: { kind: "equation", rect: [0, 9, 40, 21] },
  };
  assert.deepEqual(core.auditLayout(glyphs, [preserved], [0, 0, 600, 800]), []);
  const inline = {
    ...block("The result is $BIREAD_MATH_math$"),
    kind: "paragraph",
    anchors: [],
    inlineMath: [
      { id: "math", token: "$BIREAD_MATH_math$", rect: [0, 9, 40, 21] },
    ],
  };
  assert.deepEqual(core.auditLayout(glyphs, [inline], [0, 0, 600, 800]), []);
});
test("quality gate preserves scanned pages and rejects malformed crop rectangles", () => {
  assert.deepEqual(core.auditLayout([], [], [0, 0, 600, 800]), ["no-text"]);
  const b = {
    ...block(""),
    kind: "equation",
    anchors: [],
    originalRegion: { kind: "equation", rect: [10, 10, 9, 20] },
  };
  assert.ok(
    core
      .auditLayout(
        [{ text: "x", index: 0, rect: [0, 0, 2, 2] }],
        [b],
        [0, 0, 600, 800],
      )
      .includes("invalid-region"),
  );
});

test("quality gate detects a figure label leaking into body text", () => {
  const glyphs = [{ text: "label", index: 0, rect: [10, 10, 20, 20] }];
  const figure = {
    ...block("Figure 1"),
    kind: "caption",
    anchors: [],
    originalRegion: { kind: "figure", rect: [0, 0, 100, 100] },
  };
  const body = {
    ...block("Label"),
    kind: "paragraph",
    anchors: [
      { start: 0, end: 5, charIndex: 0, pageIndex: 0, rect: [10, 10, 20, 20] },
    ],
  };
  assert.ok(
    core
      .auditLayout(glyphs, [figure, body], [0, 0, 600, 800])
      .includes("overlapping-regions"),
  );
});

test("small-cap Roman chapters, alphabetic subsections and compact decimal headings retain hierarchy", () => {
  const blocks = [
    { ...block("Body prose ".repeat(40)), fontSize: 10 },
    { ...block("I. INTRODUCTION"), fontSize: 8 },
    { ...block("II. RELATED WORK"), fontSize: 8 },
    { ...block("A. First Approach"), fontSize: 10 },
    { ...block("C. Another Approach"), fontSize: 10 },
    { ...block("D. Implementation"), fontSize: 10 },
    { ...block("1.Introduction"), kind: "list", fontSize: 10 },
    { ...block("2.3.1 Detailed Model"), fontSize: 10 },
  ].map((b, i) => ({ ...b, id: String(i), pageIndex: 1 }));
  core.inferHierarchy(blocks);
  core.assignSections(blocks);
  assert.deepEqual(
    blocks.slice(1).map((b) => [b.kind, b.headingLevel]),
    [
      ["heading", 1],
      ["heading", 1],
      ["heading", 2],
      ["heading", 2],
      ["heading", 2],
      ["heading", 1],
      ["heading", 3],
    ],
  );
  assert.deepEqual(blocks[4].sectionPath, [
    "II. RELATED WORK",
    "C. Another Approach",
  ]);
});

test("two authors before an inline abstract and numbered affiliations are author metadata", () => {
  const blocks = [
    { ...block("A Paper Title"), kind: "title" },
    block("Anna Smith1 and Ben Jones2"),
    { ...block("Abstract— We introduce a method."), kind: "abstract" },
    block(
      "1Department of Engineering, University of Somewhere, contact@example.org",
    ),
  ];
  core.identifyFrontMatter(blocks);
  assert.equal(blocks[1].kind, "author-info");
  assert.equal(blocks[3].kind, "author-info");
  assert.equal(blocks[2].kind, "abstract");
});

test("composite figure includes side panels beyond a narrow centred caption", () => {
  const caption = {
    ...block("Fig. 3. Composite experiment"),
    kind: "caption",
    anchors: [{ rect: [220, 400, 380, 410] }],
  };
  const r = core.figureRegion(
    caption,
    [
      [40, 430, 160, 570],
      [180, 430, 420, 570],
      [440, 430, 560, 570],
    ],
    [0, 0, 600, 800],
    [caption],
  );
  assert.ok(r[0] < 40 && r[2] > 560);
});

test("matrix to the right of an equation absorbs its closing bracket as one crop", () => {
  const blocks = [
    {
      ...block("TCPj = TCP0"),
      kind: "equation",
      anchors: [{ rect: [388, 159, 444, 170] }],
    },
    { ...block("[R j t j 01"), anchors: [{ rect: [445, 154, 477, 184] }] },
    { ...block("]"), anchors: [{ rect: [477, 174, 483, 184] }] },
    {
      ...block("Following body prose remains separate."),
      anchors: [{ rect: [313, 100, 558, 139] }],
    },
  ].map((b, i) => ({ ...b, id: String(i), fontSize: 10 }));
  const out = core.preserveOriginalRegions(blocks, [], [0, 0, 612, 792]);
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, "equation");
  assert.ok(out[0].originalRegion.rect[2] >= 483);
  assert.equal(out[1].kind, "paragraph");
});

test("conference banner, ISBN footer and vertical copyright are furniture; body citations survive", () => {
  const lines = [
    ["2024 33rd International Conference on Robotics", [54, 756, 300, 764]],
    ["Interactive Communication, August 26–30", [54, 746, 300, 754]],
    ["Pasadena, California, USA.", [54, 736, 300, 744]],
    ["979-8-1234-5678-9/24/$31.00 ©2024 IEEE 438", [54, 34, 313, 42]],
    ["Proceedings | ©2024 IEEE | DOI: 10.1109/example", [12, 78, 20, 713]],
    ["Our conference results are discussed in the body.", [54, 300, 300, 310]],
  ];
  const glyphs = lines.map(([text, rect], index) => ({
    text,
    rect,
    index,
    fontSize: 8,
    lineBreakAfter: true,
    paragraphBreakAfter: index >= 2,
    rotation: index === 4 ? 90 : 0,
  }));
  const out = core.removePageFurniture([{ glyphs, box: [0, 0, 612, 792] }]);
  assert.deepEqual(
    out[0].glyphs.map((g) => g.text),
    [lines[5][0]],
  );
});

test("many equation crops render a page once and propagate render failures", async () => {
  globalThis.Components = {
    utils: {
      waiveXrays: (x) => x,
      cloneInto: (x) => x,
      createObjectIn: () => ({}),
    },
  };
  let renders = 0,
    crops = 0,
    reject = false;
  const win = {
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage() {
            crops++;
          },
        }),
        toDataURL: () => "data:image/png;base64,AA==",
      }),
    },
  };
  const pdf = {
    getPage: async () => ({
      view: [0, 0, 600, 800],
      getViewport: ({ scale }) => ({
        width: 600 * scale,
        height: 800 * scale,
        convertToViewportRectangle: (r) => r.map((v) => v * scale),
      }),
      render: () => {
        renders++;
        return {
          promise: reject
            ? Promise.reject(Error("render failed"))
            : new Promise((r) => setTimeout(r, 5)),
          cancel() {},
        };
      },
    }),
  };
  const blocks = Array.from({ length: 12 }, (_, i) => ({
    ...block("x = y"),
    id: String(i),
    pageIndex: 0,
    kind: "equation",
    originalRegion: {
      kind: "equation",
      rect: [100, 100 + i * 30, 300, 120 + i * 30],
    },
  }));
  assert.equal(
    (await core.figurePreviews(pdf, win, 0, blocks, () => false)).length,
    12,
  );
  assert.equal(renders, 1);
  assert.equal(crops, 12);
  reject = true;
  await assert.rejects(
    core.figurePreviews(pdf, win, 0, blocks, () => false),
    /render failed/,
  );
});

test("preview controller reports missing equations and retries without showing figure components", async () => {
  globalThis.Zotero = { logError() {} };
  const element = () => ({
    dataset: {},
    textContent: "",
    children: [],
    append(e) {
      this.children.push(e);
    },
    remove() {
      this.removed = true;
    },
  });
  const slot = element(),
    shown = [];
  const ui = {
    doc: { defaultView: {}, createElement: element },
    root: { querySelectorAll: () => [] },
    imageLoader: () => slot,
    showImage: (i) => shown.push(i),
  };
  const blocks = [
    { ...block("x = y"), id: "eq", kind: "equation", pageIndex: 0 },
  ];
  let images = [];
  const integration = {
    pdf: {
      getFigures: async () => images,
      getImages: async () => ({ images: [], skipped: 0 }),
    },
  };
  const controller = new core.FigureController(ui, integration, blocks);
  await controller.loadPage(0);
  assert.match(slot.textContent, /未完成/);
  assert.equal(slot.removed, undefined);
  images = [{ captionID: "eq", rect: [0, 0, 20, 20] }];
  slot.children.at(-1).onclick();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(slot.removed, true);
  assert.equal(shown.length, 1);
  controller.dispose();
  const cap = {
    ...block("Fig. 1. Experiment"),
    id: "fig",
    kind: "caption",
    pageIndex: 1,
  };
  let embedded = 0;
  const fc = new core.FigureController(
    ui,
    {
      pdf: {
        getFigures: async () => [{ captionID: "fig", rect: [0, 0, 100, 100] }],
        getImages: async () => {
          embedded++;
          return { images: [], skipped: 0 };
        },
      },
    },
    [cap],
  );
  await fc.loadPage(1);
  assert.equal(embedded, 0);
  fc.dispose();
});

test("discarded hyphens retain column boundaries and PDF font names supply missing styles", () => {
  const chars = [
    {
      u: "self",
      rect: [270, 60, 294, 70],
      fontSize: 10,
      fontName: "NimbusRomNo9L-Regu",
    },
    {
      u: "-",
      rect: [294, 60, 298, 70],
      fontSize: 10,
      ignorable: true,
      paragraphBreakAfter: true,
      lineBreakAfter: true,
    },
    {
      u: "Fig. 1. Overview",
      rect: [313, 550, 500, 558],
      fontSize: 8,
      fontName: "ABCDEF+LinLibertineTB",
      lineBreakAfter: true,
      paragraphBreakAfter: true,
    },
  ];
  const glyphs = core.readingOrder(chars);
  assert.equal(glyphs[0].paragraphBreakAfter, true);
  assert.equal(glyphs[1].bold, true);
  const blocks = core.segmentPage(glyphs, 1, "2", 800, { active: false });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].kind, "caption");
});

test("wrapped subsection heading remains one outline entry", () => {
  const bs = [
    { ...block("Body prose ".repeat(40)), fontSize: 9 },
    {
      ...block("6.3 Weather-Triggered Garden Wildlife Water"),
      bold: true,
      fontSize: 11,
      anchors: [{ rect: [318, 120, 550, 130] }],
    },
    {
      ...block("Collector"),
      bold: true,
      fontSize: 11,
      anchors: [{ rect: [342, 107, 390, 117] }],
    },
  ].map((b, i) => ({ ...b, id: String(i), pageIndex: 1 }));
  core.inferHierarchy(bs);
  assert.equal(bs.length, 2);
  assert.equal(bs[1].headingLevel, 2);
  assert.equal(
    bs[1].source,
    "6.3 Weather-Triggered Garden Wildlife Water Collector",
  );
});

test("caption and following same-size prose remain separate when PDF font styles differ", () => {
  const caption = {
    ...block("Figure 11: Overview of the inverse pipeline."),
    id: "cap",
    kind: "caption",
    bold: true,
    fontSize: 9,
    anchors: [{ rect: [54, 250, 294, 300] }],
  };
  const paragraph = {
    ...block(
      "To evaluate the accuracy of the fabricated models, we adopt the geodesic distance method and calculate errors.",
    ),
    id: "body",
    fontSize: 9,
    bold: false,
    anchors: [{ rect: [54, 200, 294, 245] }],
  };
  const out = core.preserveOriginalRegions(
    [caption, paragraph],
    [[54, 320, 294, 410]],
    [0, 0, 612, 792],
  );
  assert.equal(out.length, 2);
  assert.equal(out[1].source, paragraph.source);
  assert.ok(out[0].originalRegion.rect[1] > 300);
});

test("inline formula crops own all of their native PDF glyphs, including delayed operators", async () => {
  const bs = JSON.parse(
    await readFile(
      new URL("./fixtures/inline-math-runs.json", import.meta.url),
      "utf8",
    ),
  );
  const out = core.preserveOriginalRegions(bs, [], [0, 0, 600, 800]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "paragraph");
  assert.equal(out[0].inlineMath.length, 1);
  assert.match(
    out[0].source,
    /^in which \$BIREAD_MATH_[^$]+\$ and κ and y1 are given by$/,
  );
  assert.doesNotMatch(out[0].source, /[=+]/);
});

test("a delayed inline subscript and its following prose remain in the original sentence", () => {
  const prose = "The curve follows the relation with ε = 0.025";
  const start = prose.indexOf("ε");
  const anchors = Array.from(prose, (c, i) => ({
    start: i,
    end: i + 1,
    charIndex: i,
    pageIndex: 0,
    rect: [
      i < start ? 200 - (start - i) * 3 : 200 + (i - start) * 5,
      400,
      i < start ? 203 - (start - i) * 3 : 205 + (i - start) * 5,
      410,
    ],
  }));
  const next = "Y1, which is validated experimentally.";
  const nextAnchors = Array.from(next, (c, i) => ({
    start: i,
    end: i + 1,
    charIndex: 100 + i,
    pageIndex: 0,
    rect:
      i < 2
        ? [205 + i * 3, 397, 208 + i * 3, 404]
        : [255 + (i - 2) * 2, 400, 257 + (i - 2) * 2, 410],
  }));
  const out = core.preserveOriginalRegions(
    [
      { ...block(prose), id: "a", anchors, fontSize: 10 },
      { ...block(next), id: "b", anchors: nextAnchors, fontSize: 10 },
    ],
    [],
    [0, 0, 600, 800],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "paragraph");
  assert.equal(out[0].inlineMath.length, 1);
  assert.match(out[0].source, /which is validated experimentally/);
  assert.doesNotMatch(out[0].source, /Y1/);
});

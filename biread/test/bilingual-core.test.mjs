import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "zpt-bilingual-test-"));
const output = join(dir, "core.mjs");
await build({
  stdin: {
    contents: [
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
  assert.deepEqual(crop, [40, 423, 250, 538]);
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: [
      "originalRegions",
      "figureRegions",
      "regionLabels",
      "regionGeometry",
      "repairReadingOrder",
      "opaqueInlineGlyphs",
      "imageEquations",
      "figurePanels",
      "textTables",
      "layoutQuality",
    ]
      .map((n) => `export * from './src/bilingual/parser/${n}';`)
      .join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const core = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

test("missing figure association keeps readable prose and caption translatable", () => {
  const prose = {
    id: "body",
    kind: "paragraph",
    source: "Discussion of the experimental results.",
    anchors: [],
  };
  const caption = {
    id: "fig",
    kind: "caption",
    source: "Figure 6. Experimental setup.",
    anchors: [],
  };
  const result = core.acceptLayout(
    [prose, caption],
    ["missing-visual-region"],
    7,
    "94",
    [0, 0, 600, 800],
  );
  assert.equal(result.length, 2);
  assert.equal(result[0], prose);
  assert.equal(result[1].kind, "caption");
  assert.deepEqual(result[1].layoutIssues, ["missing-visual-region"]);
  assert.equal(
    result.some((b) => b.kind === "original-page"),
    false,
  );
});

test("local figure warning does not disable genuine unreadable-page protection", () => {
  const result = core.acceptLayout(
    [],
    ["missing-visual-region", "no-text"],
    0,
    "1",
    [0, 0, 600, 800],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "original-page");
  assert.deepEqual(result[0].layoutIssues, ["no-text"]);
});
const make = (id, source, rect, kind = "paragraph") => ({
  id,
  source,
  kind,
  pageIndex: 0,
  pageHeight: 800,
  fontSize: 10,
  segments: [],
  anchors: [
    {
      start: 0,
      end: source.length,
      charIndex: Number(id.replace(/\D/g, "")) || 0,
      pageIndex: 0,
      rect,
    },
  ],
});

test("outer-margin caption finds a unique top-aligned whole figure across a prose column", () => {
  const caption = make(
    "c1",
    "Figure 6. Structure.",
    [480, 650, 540, 695],
    "caption",
  );
  const prose = make(
    "p2",
    "Readable discussion text. ".repeat(10),
    [260, 400, 450, 695],
  );
  const r = core.figureRegion(
    caption,
    [[40, 470, 230, 700]],
    [0, 0, 600, 800],
    [caption, prose],
  );
  assert.ok(r);
  assert.ok(r[0] <= 40 && r[2] >= 230);
  assert.ok(r[2] < 260);
  const ambiguous = core.figureRegion(
    caption,
    [
      [40, 470, 230, 700],
      [260, 470, 450, 700],
    ],
    [0, 0, 600, 800],
    [caption],
  );
  assert.equal(ambiguous, undefined);
});
const prose =
  "This is a continuous prose paragraph describing the experimental procedure and explaining the observed results without a mathematical expression.";
const contains = (outer, inner) =>
  inner.every((v, i) => (i < 2 ? v >= outer[i] : v <= outer[i]));

test("a wrapped body cross-reference does not become a caption", () => {
  const before = make(
    "b1",
    "The detailed results are shown in",
    [40, 430, 270, 442],
  );
  const next = make(
    "b2",
    "Fig. 1. These measurements confirm the prediction.",
    [40, 400, 270, 412],
    "caption",
  );
  core.mergeCaptionTranslations([before, next]);
  assert.equal(next.kind, "paragraph");
});

test("unresolved visual ownership fails the layout gate instead of leaving a broken preview", () => {
  const caption = make(
    "b1",
    "Fig. 8. Experimental setup",
    [40, 400, 270, 412],
    "caption",
  );
  const glyphs = [
    { index: 1, text: caption.source, rect: caption.anchors[0].rect },
  ];
  assert.ok(
    core
      .auditLayout(glyphs, [caption], [0, 0, 600, 800])
      .includes("missing-visual-region"),
  );
  caption.originalRegion = { kind: "figure", rect: [40, 430, 270, 550] };
  assert.ok(
    !core
      .auditLayout(glyphs, [caption], [0, 0, 600, 800])
      .includes("missing-visual-region"),
  );
});

test("painted vectors and monochrome masks survive, text clipping paths do not", () => {
  const list = {
    fnArray: [91, 29, 28, 10, 12, 83, 11, 91, 20, 91, 22],
    argsArray: [
      [[], [], [0, 0, 600, 800]],
      [],
      [],
      [],
      [150, 0, 0, 80, 30, 400],
      [{}],
      [],
      [[], [], [40, 300, 240, 320]],
      [],
      [[], [], [60, 250, 220, 280]],
      [],
    ],
  };
  assert.deepEqual(core.graphicsRects(list), [
    [30, 400, 180, 480],
    [40, 300, 240, 320],
    [60, 250, 220, 280],
  ]);
});

test("grouped and repeated masks retain every transformed placement", () => {
  assert.deepEqual(
    core.graphicsRects({
      fnArray: [12, 84, 89],
      argsArray: [
        [2, 0, 0, 2, 10, 20],
        [[{ transform: [20, 0, 0, 10, 30, 40] }]],
        [{}, 10, 0, 0, 5, [60, 70, 90, 100]],
      ],
    }),
    [
      [70, 100, 110, 120],
      [130, 160, 150, 170],
      [190, 220, 210, 230],
    ],
  );
});

test("combined PDF.js path operators distinguish paint from clipping", () => {
  assert.deepEqual(
    core.graphicsRects({
      fnArray: [91, 91, 91],
      argsArray: [
        [28, [], [0, 0, 600, 800]],
        [20, [], [30, 400, 300, 500]],
        [22, [], [40, 300, 240, 350]],
      ],
    }),
    [
      [30, 400, 300, 500],
      [40, 300, 240, 350],
    ],
  );
});

for (const above of [false, true])
  test(`segmented table rules preserve the whole table ${above ? "above" : "below"} its caption`, () => {
    const caption = make(
      "b1",
      "Table IV. Experimental results",
      [330, 400, 540, 412],
      "caption",
    );
    const ys = above ? [425, 455, 485, 515] : [300, 330, 360, 390];
    const graphics = ys.flatMap((y) => [
      [325, y, 380, y + 0.5],
      [380, y, 440, y + 0.5],
      [440, y, 550, y + 0.5],
    ]);
    const expected = [325, ys[0], 550, ys.at(-1) + 0.5];
    assert.deepEqual(
      core.textTableRegion(caption, graphics, [caption]),
      expected,
    );
    const parsed = core.preserveOriginalRegions(
      [caption],
      graphics,
      [0, 0, 600, 800],
    );
    assert.ok(contains(parsed[0].originalRegion.rect, expected));
  });

test("an image-only formula stays between its introducing and explaining prose", () => {
  const before = make(
    "b1",
    "The energy balance can be expressed as",
    [40, 500, 550, 530],
  );
  const after = make(
    "b2",
    "where the coefficients describe the material response.",
    [40, 400, 550, 430],
  );
  const graphic = [160, 450, 440, 480];
  const blocks = core.preserveImageEquations(
    [before, after],
    [graphic],
    [0, 0, 600, 800],
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["paragraph", "equation", "paragraph"],
  );
  assert.ok(contains(blocks[1].originalRegion.rect, graphic));
  assert.equal(blocks[1].source, "");
  assert.equal(
    core.preserveImageEquations(
      [before, { ...after, source: "The photo shows the experiment." }],
      [graphic],
      [0, 0, 600, 800],
    ).length,
    2,
  );
});

test("explicit subfigure captions form one figure, but never across intervening prose", () => {
  const create = () => [
    {
      ...make("b1", "Fig. 3a. First panel", [40, 400, 270, 412], "caption"),
      originalRegion: { kind: "figure", rect: [40, 430, 270, 550] },
    },
    {
      ...make("b2", "Fig. 3b. Second panel", [40, 200, 270, 212], "caption"),
      originalRegion: { kind: "figure", rect: [40, 230, 270, 350] },
    },
  ];
  const merged = core.mergeFigurePanels(create());
  assert.equal(merged.length, 1);
  assert.ok(contains(merged[0].originalRegion.rect, [40, 200, 270, 550]));
  assert.ok(merged[0].source.includes("Fig. 3b."));
  const separated = core.mergeFigurePanels([
    ...create(),
    make("b3", prose, [45, 365, 265, 390]),
  ]);
  assert.equal(separated.length, 3);
});

test("ordinary prose immediately after a same-size caption remains translatable prose", () => {
  const caption = make(
    "b1",
    "Fig. 2. Experimental setup",
    [40, 400, 270, 412],
    "caption",
  );
  const body = make("b2", prose, [40, 350, 270, 395]);
  const parsed = core.preserveOriginalRegions(
    [caption, body],
    [[40, 430, 270, 550]],
    [0, 0, 600, 800],
  );
  assert.equal(parsed.find((b) => b.id === "b2")?.kind, "paragraph");
  assert.equal(parsed.find((b) => b.id === "b1")?.source, caption.source);
  assert.ok(parsed[0].originalRegion.rect[1] > 395);
});

test("underlined section headings above a figure are not part of its graphic cluster", () => {
  const caption = make(
    "b1",
    "Fig. IV. Experimental results",
    [40, 400, 270, 412],
    "caption",
  );
  const heading = {
    ...make("b2", "30 Day Experiment: Extended Analysis", [40, 570, 270, 602]),
    fontSize: 12,
  };
  const r = core.figureRegion(
    caption,
    [
      [40, 430, 270, 540],
      [40, 569, 270, 569],
      [40, 590, 270, 590],
    ],
    [0, 0, 600, 800],
    [caption, heading],
  );
  assert.ok(r && r[3] < 569);
});

test("a separate Roman section number stays outside the following figure", () => {
  const caption = make(
    "b1",
    "Fig. VII. Results",
    [40, 400, 270, 412],
    "caption",
  );
  const heading = {
    ...make("b2", "Long duration experiment results", [80, 570, 270, 602]),
    fontSize: 12,
  };
  const number = { ...make("b3", "IV.", [50, 590, 70, 602]), fontSize: 12 };
  const r = core.figureRegion(
    caption,
    [[40, 430, 270, 550]],
    [0, 0, 600, 800],
    [caption, heading, number],
  );
  assert.ok(r && r[3] < 570);
});

test("image whitespace and crop padding cannot cover a preceding heading's descenders", () => {
  const caption = make(
    "b1",
    "Fig. VII. Results",
    [40, 400, 270, 412],
    "caption",
  );
  const heading = {
    ...make("b2", "Long duration experiment results", [80, 589, 270, 602]),
    fontSize: 12,
  };
  const number = { ...make("b3", "IV.", [50, 589, 70, 602]), fontSize: 12 };
  const blocks = core.preserveOriginalRegions(
    [caption, heading, number],
    [[40, 430, 270, 590]],
    [0, 0, 600, 800],
  );
  assert.ok(blocks.find((b) => b.id === "b1").originalRegion.rect[3] < 589);
  assert.equal(blocks.find((b) => b.id === "b3").source, "IV.");
});

test("two-column prose below a full-width figure does not split its panels", () => {
  const caption = make(
    "b1",
    "Fig. 2. Complete diagram",
    [40, 200, 280, 212],
    "caption",
  );
  const blocks = [
    caption,
    make("b2", prose, [40, 50, 280, 180]),
    make("b3", prose, [320, 50, 560, 180]),
  ];
  const r = core.figureRegion(
    caption,
    [
      [40, 240, 280, 500],
      [300, 240, 560, 500],
    ],
    [0, 0, 600, 800],
    blocks,
  );
  assert.ok(r && contains(r, [40, 240, 560, 500]));
});

test("supplemental, appendix, Roman and Chinese labels share classification", () => {
  for (const s of [
    "Fig. S1. Results",
    "Extended Data Fig. 2 | Results",
    "Supplementary Figure 3. Results",
    "Figure A1. Results",
    "Fig. IV. Results",
    "图 1 结果",
  ])
    assert.equal(core.captionKind(s), "figure", s);
  for (const s of ["Table IV. Data", "Table S2 Data", "表 2 结果"])
    assert.equal(core.captionKind(s), "table", s);
  assert.equal(core.captionKind("As shown in Fig. 2"), undefined);
  for (const label of ["1", "1a", "S1", "A.1", "2.3"])
    assert.equal(core.equationNumber(`x = y (${label})`), label);
  assert.equal(
    core.equationNumber("These measurements follow (1) in the text."),
    undefined,
  );
});

for (const scale of [0.5, 1, 2])
  for (const origin of [
    [0, 0],
    [43, -70],
  ]) {
    const transform = (r) => r.map((v, i) => v * scale + origin[i % 2]);
    const scaled = (b) => ({
      ...b,
      fontSize: b.fontSize * scale,
      pageHeight: 800 * scale,
      anchors: b.anchors.map((a) => ({ ...a, rect: transform(a.rect) })),
    });
    test(`single-column display equation owns all scripts at scale ${scale} origin ${origin}`, () => {
      const blocks = [
        make("b1", "x = y", [100, 400, 320, 414]),
        make("b2", "2", [130, 414, 136, 421]),
        make("b3", "(A.1)", [550, 400, 580, 414]),
        make("b4", prose, [40, 440, 580, 510]),
      ].map(scaled);
      const result = core.preserveOriginalRegions(
        blocks,
        [],
        transform([0, 0, 600, 800]),
      );
      const equations = result.filter((b) => b.kind === "equation");
      assert.equal(equations.length, 1);
      assert.ok(
        contains(
          equations[0].originalRegion.rect,
          transform([100, 400, 580, 421]),
        ),
      );
      assert.equal(result.find((b) => b.id === "b4").source, prose);
    });
    test(`complete multi-panel figure is invariant at scale ${scale} origin ${origin}`, () => {
      const c = scaled(
        make("c1", "Figure S1. Composite", [225, 100, 375, 112], "caption"),
      );
      const graphics = [
        [40, 130, 200, 270],
        [220, 130, 380, 270],
        [400, 130, 560, 270],
      ].map(transform);
      const found = core.figureRegion(
        c,
        [...graphics].reverse(),
        transform([0, 0, 600, 800]),
        [c],
      );
      assert.ok(found);
      for (const r of graphics) assert.ok(contains(found, r));
    });
  }

test("off-centre prose gutter keeps simultaneous equations in separate columns", () => {
  const blocks = [
    make("b1", prose, [30, 450, 250, 550]),
    make("b2", prose, [280, 450, 570, 550]),
    make("e3", "x = y (1)", [70, 390, 240, 406], "equation"),
    make("e4", "u = v (2)", [320, 390, 560, 406], "equation"),
    make("s5", "2", [110, 406, 116, 414]),
    make("s6", "3", [360, 406, 366, 414]),
  ];
  const result = core.preserveOriginalRegions(blocks, [], [0, 0, 600, 800]);
  const equations = result.filter((b) => b.kind === "equation");
  assert.equal(equations.length, 2);
  assert.ok(equations[0].originalRegion.rect[2] < 265);
  assert.ok(equations[1].originalRegion.rect[0] > 265);
});

test("intervening prose prevents a caption taking an unrelated illustration", () => {
  const c = make("c1", "Fig. 1. Results", [40, 100, 280, 112], "caption");
  const p = make("p2", prose, [40, 130, 280, 160]);
  assert.equal(
    core.figureRegion(c, [[40, 180, 280, 280]], [0, 0, 600, 800], [c, p]),
    undefined,
  );
});

test("adjacent bilingual captions have one owner and retain both explanations", () => {
  const a = make("c1", "图 6 地形高度角", [70, 200, 260, 212], "caption"),
    b = make(
      "c2",
      "Fig. 6 Local terrain elevation",
      [40, 184, 280, 196],
      "caption",
    ),
    c = make(
      "c3",
      "Fig. 7 Annual illuminance",
      [320, 100, 560, 112],
      "caption",
    );
  const result = core.mergeCaptionTranslations([a, b, c]);
  assert.equal(result.length, 2);
  assert.match(result[0].source, /图 6.*\nFig\. 6/);
  assert.equal(result[0].anchors.length, 2);
  const r = core.figureRegion(
    result[0],
    [
      [50, 225, 270, 380],
      [330, 130, 560, 380],
    ],
    [0, 0, 600, 800],
    result,
  );
  assert.ok(r[2] < 300);
});

test("fractured native column runs rebuild sentences without mixing real columns", () => {
  const source = "abcdefghijklmno",
    glyphs = [];
  let index = 0;
  for (const column of [0, 1])
    for (const fragment of [0, 1, 2])
      for (let line = 0; line < 7; line++)
        for (let j = 0; j < 5; j++) {
          const x = 40 + column * 300 + (fragment * 5 + j) * 5,
            y = 600 - line * 14;
          glyphs.push({
            index: index++,
            text: source[fragment * 5 + j],
            fontSize: 10,
            rect: [x, y, x + 5, y + 10],
            lineBreakAfter: j === 4,
          });
        }
  const repaired = core.repairReadingOrder(glyphs);
  const lines = [];
  let line = "";
  for (const g of repaired) {
    line += g.text;
    if (g.lineBreakAfter) {
      lines.push(line);
      line = "";
    }
  }
  assert.deepEqual(lines, Array(14).fill(source));
  assert.equal(new Set(repaired.map((g) => g.index)).size, glyphs.length);
  assert.ok(repaired.slice(0, 105).every((g) => g.rect[0] < 200));
});

test("normal native reading order and superscript runs stay unchanged", () => {
  const glyphs = [
    { text: "x", index: 0, fontSize: 10, rect: [40, 400, 45, 410] },
    { text: "2", index: 1, fontSize: 6, rect: [45, 408, 48, 414] },
    { text: "next", index: 2, fontSize: 10, rect: [50, 400, 80, 410] },
  ];
  assert.equal(core.repairReadingOrder(glyphs), glyphs);
});

test("private font symbols are preserved inline with exact surrounding text and anchors", () => {
  const source =
    "The flight requires (\uf044V) and another (\uf044T) measurement.";
  const b = make("b1", source, [40, 100, 400, 110]);
  b.anchors = [...source].map((text, i) => ({
    start: i,
    end: i + 1,
    charIndex: i,
    pageIndex: 0,
    rect: [40 + i * 5, 100, 45 + i * 5, 110],
  }));
  core.preserveOpaqueInlineGlyphs([b]);
  assert.equal(b.inlineMath.length, 2);
  assert.equal(
    b.source.replace(/\$BIREAD_MATH_[^$]+\$/g, "MATH"),
    "The flight requires MATH and another MATH measurement.",
  );
  for (const a of b.anchors)
    assert.equal(b.source.slice(a.start, a.end), source[a.charIndex]);
  for (const m of b.inlineMath) assert.ok(m.rect[2] - m.rect[0] < 25);
});

test("local math and glyph faults never suppress neighboring readable paragraphs", () => {
  const body = make(
    "b1",
    "The experiment evaluates the performance under controlled conditions.",
    [20, 600, 280, 640],
  );
  const bad = make("b2", "\ue001 + x = 2", [20, 550, 150, 570]);
  const result = core.acceptLayout(
    [body, bad],
    ["unreadable-glyphs", "fragmented-math"],
    0,
    "1",
    [0, 0, 600, 800],
  );
  assert.equal(result[0], body);
  assert.equal(result[0].kind, "paragraph");
  assert.equal(result[1].kind, "equation");
  assert.deepEqual(result[1].originalRegion.rect, [20, 550, 150, 570]);
  assert.ok(result[1].layoutIssues.includes("local-original"));
  assert.ok(!result.some((b) => b.kind === "original-page"));
});

test("invalid and overlapping figure crops preserve prose and caption translation", () => {
  for (const rect of [
    [NaN, 0, 600, 800],
    [0, 0, 600, 800],
  ]) {
    const body = make(
      "b1",
      "Discussion of the measured results and their implications.",
      [30, 300, 290, 500],
    );
    const caption = make(
      "b2",
      "Figure 1. Apparatus.",
      [30, 200, 280, 220],
      "caption",
    );
    caption.originalRegion = { kind: "figure", rect };
    const result = core.acceptLayout(
      [body, caption],
      ["invalid-region", "overlapping-regions"],
      0,
      "1",
      [0, 0, 600, 800],
    );
    assert.equal(result[0].kind, "paragraph");
    assert.equal(result[1].kind, "caption");
    assert.equal(result[1].originalRegion, undefined);
    assert.ok(result[1].layoutIssues.includes("missing-visual-region"));
  }
});

test("omitted text is recovered without extracting labels from preserved figures", () => {
  const body = make("b1", "Existing prose remains.", [20, 600, 280, 620]);
  const fig = make("b2", "Figure 1. Setup.", [20, 200, 280, 220], "caption");
  fig.originalRegion = { kind: "figure", rect: [20, 230, 280, 400] };
  const glyphs = [
    { index: 1, text: body.source, rect: [20, 600, 280, 620], fontSize: 10 },
    {
      index: 3,
      text: "Recovered discussion remains translatable.",
      rect: [20, 440, 280, 455],
      fontSize: 10,
    },
    { index: 4, text: "Axis label", rect: [30, 300, 70, 310], fontSize: 10 },
  ];
  const result = core.acceptLayout(
    [body, fig],
    ["missing-text"],
    0,
    "1",
    [0, 0, 600, 800],
    glyphs,
  );
  const recovered = result.find((b) =>
    b.source.includes("Recovered discussion"),
  );
  assert.ok(recovered);
  assert.ok(recovered.segments.length);
  assert.ok(
    !result.some(
      (b) => b.source.includes("Axis label") || b.kind === "original-page",
    ),
  );
});

test("empty parser output with usable source text is reparsed, not replaced by a page image", () => {
  const result = core.acceptLayout(
    [],
    ["missing-text"],
    0,
    "1",
    [0, 0, 600, 800],
    [
      {
        index: 0,
        text: "Readable text must be translated despite a failed region detector.",
        rect: [20, 300, 280, 320],
        fontSize: 10,
      },
    ],
  );
  assert.ok(result.length);
  assert.ok(result.every((b) => b.kind !== "original-page"));
  assert.ok(result[0].segments.length);
});

for (const scale of [0.5, 1, 2])
  test(`page-height three-rule table keeps multiline values in logical rows at scale ${scale}`, () => {
    const r = (v) => v.map((n) => n * scale);
    const caption = make(
      "table0",
      "Table 1.1 Definitions of terms",
      r([10, 760, 400, 775]),
      "caption",
    );
    caption.fontSize = 10 * scale;
    let index = 1;
    const glyphs = [];
    const word = (text, x, y, width, join = false) =>
      glyphs.push({
        text,
        index: index++,
        rect: r([x, y, x + width, y + 10]),
        fontSize: 10 * scale,
        joinsNextLine: join,
      });
    word("Term", 20, 720, 40);
    word("Definition", 160, 720, 70);
    for (let n = 0; n < 4; n++) {
      const y = 670 - n * 140;
      word("Concept " + n, 20, y, 80);
      word("A detailed definition", 160, y, 180);
      word("with a second line", 160, y - 15, 160);
      word("and the final statement.", 160, y - 30, 190);
    }
    const rules = [740, 705, 120].map((y) => r([10, y, 400, y]));
    const { cells, consumed } = core.extractTextTables(glyphs, rules, [
      caption,
    ]);
    assert.equal(cells.length, 10);
    assert.equal(consumed.size, glyphs.length);
    for (let n = 1; n <= 4; n++) {
      const value = cells.find(
        (c) => c.table.row === n && c.table.column === 1,
      );
      assert.equal(
        value.source,
        "A detailed definition with a second line and the final statement.",
      );
      assert.equal(value.table.rows, 5);
      assert.equal(value.anchors.length, 3);
      assert.equal(value.segments.length, 1);
    }
    const preserved = core.preserveOriginalRegions(
      [caption, ...cells],
      rules,
      r([0, 0, 600, 800]),
    );
    assert.equal(preserved.filter((b) => b.kind === "table-cell").length, 10);
    assert.equal(caption.originalRegion.kind, "table");
  });

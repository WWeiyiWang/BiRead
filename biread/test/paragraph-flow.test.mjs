import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const built = await build({
  stdin: {
    contents: [
      "parser/inlineFlow",
      "parser/readingOrder",
      "parser/blockSegmenter",
      "parser/originalRegions",
      "parser/layoutQuality",
      "translation/continuousTranslation",
      "translation/textProtection",
    ]
      .map((p) => `export * from './src/bilingual/${p}';`)
      .join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/paragraph-math-flow.json", import.meta.url)),
);
const parse = (chars) => {
  const glyphs = api.readingOrder(chars);
  const flow = api.restoreInlineFlow(glyphs, 1);
  const blocks = api.segmentPage(flow, 1, "2", 1600, { active: false });
  api.inferHierarchy(blocks);
  return { glyphs, flow, blocks };
};

for (const scale of [0.6, 1, 2])
  test(`stacked inline fractions stay in one paragraph at scale ${scale}`, () => {
    const input = fixtures[0].chars.map((g) => ({
      ...g,
      rect: g.rect.map((n, i) => n * scale + (i % 2 ? 30 : -20)),
      fontSize: g.fontSize * scale,
      baseline: g.baseline * scale + 30,
    }));
    const { glyphs, blocks } = parse(input);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, "paragraph");
    assert.equal(blocks[0].inlineMath.length, 8);
    assert.match(
      blocks[0].source,
      /this leads to \$BIREAD_MATH_[^$]+\$ and \$BIREAD_MATH_[^$]+\$\. Therefore/,
    );
    assert.match(
      blocks[0].source,
      /variables, \$BIREAD_MATH_[^$]+\$ and \$BIREAD_MATH_[^$]+\$, making/,
    );
    assert.equal(
      api
        .auditLayout(glyphs, blocks, [-20, 0, 1250, 1650])
        .includes("missing-text"),
      false,
    );
    for (const m of blocks[0].inlineMath) {
      const tokenAt = blocks[0].source.indexOf(m.token);
      assert.ok(tokenAt >= 0);
      assert.ok(m.rect[3] - m.rect[1] < 18 * scale);
    }
  });

test("superscript, subscript and a solitary variable keep surrounding prose intact", () => {
  const { blocks } = parse(fixtures[1].chars);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].source, /^in which \$BIREAD_MATH_[^$]+\$ denotes/);
  assert.match(blocks[0].source, /characterizes/);
  assert.match(blocks[0].source, /\$BIREAD_MATH_[^$]+\$ is preferred/);
  assert.ok(blocks[0].inlineMath.length >= 7);
});

test("an ordinary sentence beginning with A remains in its original paragraph", () => {
  const { blocks } = parse(fixtures[2].chars);
  assert.equal(blocks[0].kind, "heading");
  const prose = blocks.find((b) => b.source.includes("A ping-pong"));
  assert.equal(prose.kind, "paragraph");
  assert.ok(prose.source.startsWith("To evaluate"));
  assert.match(prose.source, /suspended from a wire \(32 AWG/);
  assert.equal(blocks.filter((b) => b.kind === "heading").length, 1);
});

test("alphabetic sentences differ from explicit alphabetic subsection markers", () => {
  const source = [
    "A model is suspended from a wire",
    "I measured the output of this device",
    "A. Model Construction",
    "II. RESULTS",
    "1.Introduction",
    "2.3 Detailed Model",
  ];
  const bs = source.map((text, i) => ({
    id: String(i),
    kind: "paragraph",
    source: text,
    fontSize: 10,
    pageIndex: 1,
    anchors: [],
    segments: [],
  }));
  api.inferHierarchy(bs);
  assert.deepEqual(
    bs.map((b) => b.kind),
    ["paragraph", "paragraph", "heading", "heading", "heading", "heading"],
  );
  assert.deepEqual(
    bs.slice(2).map((b) => b.headingLevel),
    [2, 1, 1, 2],
  );
});

test("same-baseline columns are never merged by inline reconstruction", () => {
  const a = fixtures[0].chars;
  const b = a.map((g) => ({
    ...g,
    rect: g.rect.map((n, i) => n + (i % 2 ? 0 : 280)),
  }));
  const { blocks } = parse([...a, ...b]);
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((b) => b.inlineMath.length === 8));
  assert.ok(blocks[0].inlineMath.every((m) => m.rect[2] < 300));
  assert.ok(blocks[1].inlineMath.every((m) => m.rect[0] > 300));
});

test("isolated plot labels and display fractions are not assigned prose owners", () => {
  const gs = api.readingOrder(
    fixtures[0].chars.filter((g) => /^(?:y|h|4|=|′)$/.test(g.u)),
  );
  assert.deepEqual(api.restoreInlineFlow(gs, 0), gs);
});

test("math-dense line beginnings and delayed summation scripts keep their sentence", () => {
  const { blocks } = parse(fixtures[3].chars);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
  assert.match(blocks[0].source, /commonly defined as.*where.*are modes/);
  assert.ok(blocks[0].inlineMath.length > 10);
  const images = blocks[0].inlineMath;
  for (let i = 0; i < images.length; i++)
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i].rect,
        b = images[j].rect;
      assert.ok(
        Math.min(a[2], b[2]) - Math.max(a[0], b[0]) < 0.5 ||
          Math.min(a[3], b[3]) - Math.max(a[1], b[1]) < 0.5,
        "competing formula crops",
      );
    }
});

test("small type glossary words remain translatable prose", () => {
  const { blocks } = parse(fixtures[4].chars);
  assert.match(blocks[0].source, /relies on the Lie group of/);
});

test("a leading subscript cannot separate a continuation from its preceding line", () => {
  const { blocks } = parse(fixtures[5].chars);
  assert.equal(blocks.length, 1);
  assert.match(
    blocks[0].source,
    /internal wrenches \$BIREAD_MATH_[^$]+\$ that act directly/,
  );
});

test("unreconstructed roman fragments and a vector missing operands fail the layout gate", () => {
  const block = (id, source, kind = "paragraph") => ({
    id,
    source,
    kind,
    anchors: [],
    segments: [],
    fontSize: 10,
  });
  const body = block(
    "body",
    "This is ordinary prose surrounding the mathematical expression. ".repeat(
      4,
    ),
  );
  assert.ok(
    api
      .auditLayout(
        [],
        [body, block("a", "h"), block("b", "y h′")],
        [0, 0, 600, 800],
      )
      .includes("fragmented-math"),
  );
  assert.ok(
    api
      .auditLayout(
        [],
        [body, block("vector", "• A becomes [ , ]", "list")],
        [0, 0, 600, 800],
      )
      .includes("fragmented-math"),
  );
  assert.equal(
    api
      .auditLayout(
        [],
        [
          body,
          block(
            "vector",
            "• A becomes [$BIREAD_MATH_a$, $BIREAD_MATH_b$]",
            "list",
          ),
        ],
        [0, 0, 600, 800],
      )
      .includes("fragmented-math"),
    false,
  );
  assert.equal(
    api
      .auditLayout(
        [],
        [body, block("labelA", "(8a)"), block("labelB", "(8b)")],
        [0, 0, 600, 800],
      )
      .includes("fragmented-math"),
    false,
  );
});

test("MT receives one sentence, keeps every formula and allows translated word order", async () => {
  const text = "The ratio $BIREAD_MATH_a$ increases with $BIREAD_MATH_b$.";
  let calls = 0;
  const out = await api.translateContinuous(
    api.protectText(text).parts,
    async (raw) => {
      calls++;
      assert.equal(raw, "The ratio ZXQKEEP0QXZ increases with ZXQKEEP1QXZ.");
      return "随着ZXQKEEP1QXZ增加，比例ZXQKEEP0QXZ增大。";
    },
  );
  assert.equal(calls, 1);
  assert.equal(out, "随着$BIREAD_MATH_b$增加，比例$BIREAD_MATH_a$增大。");
});

for (const corrupt of ["omitted", "duplicate", "unknown"])
  test(`MT ${corrupt} markers fall back without losing a formula`, async () => {
    const parts = [
      { text: "The ratio ", protected: false },
      { text: "$BIREAD_MATH_a$", protected: true },
      { text: " increases.", protected: false },
    ];
    let calls = 0;
    const out = await api.translateContinuous(parts, async (raw) => {
      if (++calls === 1)
        return corrupt === "omitted"
          ? "比值增大。"
          : corrupt === "duplicate"
            ? "ZXQKEEP0QXZ ZXQKEEP0QXZ"
            : "ZXQKEEP9QXZ";
      assert.ok(!raw.includes("BIREAD"));
      return raw === "The ratio" ? "比值" : "增大。";
    });
    assert.equal(out, "比值 $BIREAD_MATH_a$ 增大。");
  });

test("network failures do not trigger retries disguised as token fallbacks", async () => {
  let calls = 0;
  await assert.rejects(
    api.translateContinuous(
      [
        { text: "Value ", protected: false },
        { text: "$x$", protected: true },
      ],
      async () => {
        calls++;
        throw Error("timeout");
      },
    ),
    /timeout/,
  );
  assert.equal(calls, 1);
});

test("original marker-looking text cannot collide with generated tokens", async () => {
  const out = await api.translateContinuous(
    [
      { text: "ZXQKEEP0QXZ remains ", protected: false },
      { text: "$x$", protected: true },
    ],
    async (raw) => raw,
  );
  assert.equal(out, "ZXQKEEP0QXZ remains $x$");
});

test("italic prose with PDF ligatures is not mistaken for inline math", () => {
  let x = 20;
  const text = "Static Pose/Conﬁguration Assignment is used for future tasks.";
  const chars = Array.from(text, (text, index) => {
    const g = {
      text,
      index,
      rect: [x, 100, x + 5, 110],
      baseline: 102,
      fontSize: 10,
      italic: true,
      spaceAfter: false,
    };
    x += 5;
    return g;
  });
  chars.at(-1).paragraphBreakAfter = true;
  const flow = api.restoreInlineFlow(chars, 0);
  assert.equal(
    flow.some((g) => g.inlineMath),
    false,
  );
  assert.equal(flow.map((g) => g.text).join(""), text);
});

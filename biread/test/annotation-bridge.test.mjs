import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "biread-annotations-"));
const output = join(dir, "bridge.mjs");
await build({
  entryPoints: ["src/bilingual/annotations/zoteroAnnotationBridge.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "external-services",
      setup(b) {
        b.onResolve(
          { filter: /translation\/providers|reader\/pdfIntegration/ },
          (args) => ({ path: args.path, namespace: "stub" }),
        );
        b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents: args.path.includes("providers")
            ? "export const annotationCandidate = (...args) => globalThis.candidate(...args);"
            : "export async function focusAnnotation() {}",
          loader: "js",
        }));
      },
    },
  ],
});
const { AnnotationBridge } = await import(pathToFileURL(output));
await rm(dir, { recursive: true, force: true });

function fixture(candidate) {
  const files = new Map(),
    items = new Map();
  let id = 0;
  globalThis.candidate = candidate;
  globalThis._globalThis = { crypto: globalThis.crypto, TextEncoder };
  globalThis.PathUtils = { join: (...p) => p.join("/") };
  globalThis.IOUtils = {
    exists: async (p) => files.has(p),
    readJSON: async (p) => structuredClone(files.get(p)),
    makeDirectory: async () => {},
    writeJSON: async (p, v) => files.set(p, structuredClone(v)),
  };
  globalThis.Zotero = {
    Prefs: { get: () => undefined },
    DataDirectory: { dir: "test" },
    logError: (e) => {
      throw e;
    },
    Notifier: {
      registerObserver: () => "observer",
      unregisterObserver: () => {},
    },
    DataObjectUtilities: { generateKey: () => "KEY" + ++id },
    Items: { getByLibraryAndKey: (_, key) => items.get(key) },
    Annotations: {
      saveFromJSON: async (_, a) =>
        items.set(a.key, {
          ...a,
          parentID: 1,
          annotationType: a.type,
          annotationPosition: JSON.stringify(a.position),
          annotationColor: a.color,
          annotationComment: a.comment,
          isAnnotation: () => true,
          isEditable: () => true,
          annotationText: a.text,
          annotationPageLabel: a.pageLabel,
          annotationSortIndex: a.sortIndex,
          saveTx: async () => {},
        }),
    },
  };
  const source = "Archives preserve collective memory and tradition.";
  const translation = "档案保存集体记忆和传统。";
  const block = {
    id: "block",
    source,
    translation,
    pageIndex: 0,
    pageLabel: "1",
    pageHeight: 800,
    segments: [
      {
        id: "s",
        sourceStart: 0,
        sourceEnd: source.length,
        translationStart: 0,
        translationEnd: translation.length,
      },
    ],
    anchors: [...source].map((_, i) => ({
      start: i,
      end: i + 1,
      charIndex: i,
      pageIndex: 0,
      rect: [i * 5, 700, i * 5 + 5, 710],
    })),
  };
  const integration = {
    identity: "document",
    item: {
      id: 1,
      libraryID: 1,
      isEditable: () => true,
      getAnnotations: () => [...items.values()],
    },
    win: { confirm: () => true },
  };
  const newBridge = () =>
    new AnnotationBridge(
      integration,
      () => [block],
      () => {},
    );
  return {
    block,
    items,
    integration,
    newBridge,
    setGlossary: async (glossary) => {
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode("document"),
          ),
        ),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      files.set(
        "test/biread-bilingual-v1/glossary-" + hash + ".json",
        glossary,
      );
    },
  };
}

test("Chinese selection remains highlighted, editable and persistent when provider fails", async () => {
  const { block, items, newBridge } = fixture(async () => {
    throw Error("offline");
  });
  let bridge = newBridge();
  await bridge.start();
  const start = block.translation.indexOf("集体记忆");
  const key = await bridge.create(
    block,
    "translation",
    start,
    start + 4,
    "#ffd400",
  );
  assert.equal(items.size, 0);
  assert.equal(bridge.mappings(block)[0].translation.text, "集体记忆");
  assert.equal(bridge.mappings(block)[0].source.text, "");
  await bridge.comment(key, "my note");
  await bridge.color(key, "#ff6666");
  bridge.dispose();
  bridge = newBridge();
  await bridge.start();
  assert.equal(bridge.mappings(block)[0].comment, "my note");
  assert.equal(bridge.mappings(block)[0].color, "#ff6666");
  await bridge.remove(key);
  assert.equal(bridge.mappings(block).length, 0);
});

test("existing unmatched English mark can acquire a counterpart later", async () => {
  const { block, newBridge, setGlossary } = fixture();
  const bridge = newBridge();
  await bridge.start();
  const start = block.source.indexOf("collective memory");
  const key = await bridge.create(
    block,
    "source",
    start,
    start + 17,
    "#ffd400",
    "underline",
  );
  assert.equal(bridge.binding(key).mapping.translation.text, "");
  await setGlossary({ "collective memory": "集体记忆" });
  await bridge.reconcile(block);
  assert.equal(bridge.binding(key).mapping.translation.text, "集体记忆");
  assert.equal(bridge.binding(key).mapping.type, "underline");
});

test("local Chinese mark is promoted with its colour, underline and note intact", async () => {
  const { block, newBridge, setGlossary, items } = fixture();
  const bridge = newBridge();
  await bridge.start();
  const local = await bridge.create(
    block,
    "translation",
    4,
    8,
    "#5fb236",
    "underline",
  );
  await bridge.comment(local, "preserve my note");
  await setGlossary({ "collective memory": "集体记忆" });
  await bridge.reconcile(block);
  const key = local.replace("local-", "");
  assert.equal(bridge.isLocal(local), false);
  assert.equal(items.size, 1);
  assert.equal(items.get(key).annotationComment, "preserve my note");
  assert.equal(items.get(key).annotationColor, "#5fb236");
  assert.equal(items.get(key).annotationType, "underline");
  const reopened = newBridge();
  await reopened.start();
  assert.equal(reopened.binding(key).mapping.translation.text, "集体记忆");
  assert.equal(reopened.binding(key).mapping.source.text, "collective memory");
});

test("canonical save, colour edit and deletion update the native reader immediately", async () => {
  const { block, newBridge, setGlossary, items, integration } = fixture();
  const paints = [],
    removed = [];
  integration.reader = {
    setAnnotations: async (items) =>
      paints.push(
        items.map((i) => ({
          key: i.key,
          color: i.annotationColor,
          type: i.annotationType,
        })),
      ),
    unsetAnnotations: async (keys) => removed.push(keys),
  };
  await setGlossary({ "collective memory": "集体记忆" });
  const bridge = newBridge();
  await bridge.start();
  const key = await bridge.create(
    block,
    "translation",
    4,
    8,
    "#5fb236",
    "underline",
  );
  assert.deepEqual(paints.at(-1), [
    { key, color: "#5fb236", type: "underline" },
  ]);
  await bridge.color(key, "#ff6666");
  assert.equal(paints.at(-1)[0].color, "#ff6666");
  items.get(key).eraseTx = async () => items.delete(key);
  await bridge.remove(key);
  assert.deepEqual(removed, [[key]]);
  assert.equal(bridge.mappings(block).length, 0);
});

test("reader coordinate rounding keeps the exact Chinese selection until the PDF mark moves", async () => {
  const { block, newBridge, setGlossary, items } = fixture();
  for (const a of block.anchors) a.rect = a.rect.map((n) => n + 0.0004);
  await setGlossary({ "collective memory": "集体记忆" });
  const bridge = newBridge();
  await bridge.start();
  const key = await bridge.create(block, "translation", 4, 8, "#ffd400");
  const position = JSON.parse(items.get(key).annotationPosition);
  items.get(key).annotationPosition = JSON.stringify({
    rects: position.rects.map((r) => r.map((n) => Math.round(n * 1000) / 1000)),
    pageIndex: 0,
  });
  await bridge.refresh();
  assert.equal(bridge.binding(key).mapping.translation.text, "集体记忆");
  items.get(key).annotationPosition = JSON.stringify({
    pageIndex: 0,
    rects: [[0, 700, 40, 710]],
  });
  await bridge.refresh();
  assert.equal(bridge.binding(key).mapping.translation.text, "");
});

test("English word only marks the matching Chinese phrase", async () => {
  const { block, newBridge, setGlossary } = fixture(async () => {
    throw Error("No network expected");
  });
  await setGlossary({ "collective memory": "集体记忆" });
  const bridge = newBridge();
  await bridge.start();
  const start = block.source.indexOf("collective memory");
  await bridge.create(
    block,
    "source",
    start,
    start + 17,
    "#ffd400",
    "underline",
  );
  const [mapping] = bridge.mappings(block);
  assert.equal(mapping.source.text, "collective memory");
  assert.equal(mapping.translation.text, "集体记忆");
  assert.equal(mapping.type, "underline");
});

test("English unmatched word never expands to a Chinese sentence", async () => {
  const { block, newBridge } = fixture(async () => "不存在");
  const bridge = newBridge();
  await bridge.start();
  await bridge.create(block, "source", 0, 8, "#ffd400");
  const [mapping] = bridge.mappings(block);
  assert.equal(mapping.source.text, "Archives");
  assert.equal(mapping.translation.text, "");
});

test("Chinese word writes only the matched English phrase to PDF", async () => {
  const { block, newBridge, items, setGlossary } = fixture(async () => {
    throw Error("No network expected");
  });
  await setGlossary({ tradition: "传统" });
  const bridge = newBridge();
  await bridge.start();
  const start = block.translation.indexOf("传统");
  const key = await bridge.create(
    block,
    "translation",
    start,
    start + 2,
    "#ffd400",
  );
  assert.equal(items.get(key).text, "tradition");
  assert.equal(bridge.mappings(block)[0].translation.text, "传统");
});

test("manual binding promotes local Chinese annotation and persists its exact pair", async () => {
  const { block, newBridge, items } = fixture(async () => "");
  let bridge = newBridge();
  await bridge.start();
  const targetStart = block.translation.indexOf("传统");
  const key = await bridge.create(
    block,
    "translation",
    targetStart,
    targetStart + 2,
    "#ffd400",
    "underline",
  );
  await bridge.comment(key, "keep this note");
  const sourceStart = block.source.indexOf("tradition");
  const promoted = await bridge.rebind(
    key,
    block,
    [sourceStart, sourceStart + 9],
    [targetStart, targetStart + 2],
  );
  assert.equal(bridge.isLocal(key), false);
  assert.equal(items.size, 1);
  assert.equal(items.get(promoted).annotationComment, "keep this note");
  assert.equal(items.get(promoted).annotationType, "underline");
  bridge.dispose();
  bridge = newBridge();
  await bridge.start();
  const m = bridge.mappings(block)[0];
  assert.equal(m.source.text, "tradition");
  assert.equal(m.translation.text, "传统");
  globalThis.candidate = () => {
    throw Error("Should reuse saved pair");
  };
  await bridge.create(block, "source", sourceStart, sourceStart + 9, "#ffd400");
  assert.equal(bridge.mappings(block)[1].translation.text, "传统");
});

test("old PDF annotation can be rebound without replacing its key or comment", async () => {
  const { block, newBridge, items } = fixture(async () => "");
  const bridge = newBridge();
  await bridge.start();
  const key = await bridge.create(block, "source", 0, 8, "#ff6666");
  items.get(key).annotationComment = "old note";
  const sourceStart = block.source.indexOf("collective memory");
  const targetStart = block.translation.indexOf("集体记忆");
  assert.equal(
    await bridge.rebind(
      key,
      block,
      [sourceStart, sourceStart + 17],
      [targetStart, targetStart + 4],
    ),
    key,
  );
  assert.equal(items.size, 1);
  assert.equal(items.get(key).annotationComment, "old note");
  assert.equal(items.get(key).annotationColor, "#ff6666");
  assert.equal(bridge.mappings(block)[0].source.text, "collective memory");
  assert.equal(bridge.mappings(block)[0].translation.text, "集体记忆");
});

test("failed PDF rebind restores old mapping and rejects invalid ranges", async () => {
  const { block, newBridge, items } = fixture(async () => "");
  let bridge = newBridge();
  await bridge.start();
  const key = await bridge.create(block, "source", 0, 8, "#ffd400");
  const before = items.get(key).annotationPosition;
  items.get(key).saveTx = async () => {
    throw Error("save failed");
  };
  await assert.rejects(
    bridge.rebind(key, block, [0, 8], [0, 2]),
    /save failed/,
  );
  assert.equal(items.get(key).annotationPosition, before);
  bridge.dispose();
  bridge = newBridge();
  await bridge.start();
  assert.equal(bridge.mappings(block)[0].translation.text, "");
  await assert.rejects(bridge.rebind(key, block, [-1, 8], [0, 2]));
  assert.equal(items.size, 1);
});

test("unconfident contextual result keeps only the selected side", async () => {
  const { block, newBridge } = fixture(async () =>
    JSON.stringify({ quote: "档案", confident: false }),
  );
  const bridge = newBridge();
  await bridge.start();
  await bridge.create(block, "source", 0, 8, "#ffd400");
  assert.equal(bridge.mappings(block)[0].translation.text, "");
});

test("local alignment never calls a provider, and confirmation can decline or cancel without cross-highlighting", async () => {
  let calls = 0;
  const { block, newBridge, items, setGlossary } = fixture(async () => {
    calls++;
    return "anything";
  });
  await setGlossary({ tradition: "传统" });
  const bridge = newBridge();
  await bridge.start();
  const start = block.translation.indexOf("传统");
  await assert.rejects(
    bridge.create(
      block,
      "translation",
      start,
      start + 2,
      "#ffd400",
      "highlight",
      async (source, target) => {
        assert.equal(source, "tradition");
        assert.equal(target, "传统");
        assert.equal(items.size, 0);
        return "cancel";
      },
    ),
    /取消/,
  );
  assert.equal(bridge.mappings(block).length, 0);
  const key = await bridge.create(
    block,
    "translation",
    start,
    start + 2,
    "#ffd400",
    "highlight",
    async () => "single",
  );
  assert.equal(bridge.isLocal(key), true);
  assert.equal(items.size, 0);
  assert.equal(calls, 0);
});

test("confirmed pair is reused at a different occurrence and stale preview is rejected", async () => {
  const { block, newBridge, setGlossary } = fixture(async () => {
    throw Error("no network");
  });
  await setGlossary({ tradition: "传统" });
  const bridge = newBridge();
  await bridge.start();
  const start = block.translation.indexOf("传统");
  await bridge.create(
    block,
    "translation",
    start,
    start + 2,
    "#ffd400",
    "highlight",
    async () => "accept",
  );
  await setGlossary({});
  block.source = "Our tradition matters.";
  block.translation = "我们的传统很重要。";
  block.segments = [
    {
      id: "s",
      sourceStart: 0,
      sourceEnd: block.source.length,
      translationStart: 0,
      translationEnd: block.translation.length,
    },
  ];
  const newStart = block.source.indexOf("tradition");
  let target;
  await bridge.create(
    block,
    "source",
    newStart,
    newStart + 9,
    "#ffd400",
    "highlight",
    async (_, chinese) => {
      target = chinese;
      return "accept";
    },
  );
  assert.equal(target, "传统");
  await assert.rejects(
    bridge.create(
      block,
      "source",
      newStart,
      newStart + 9,
      "#ffd400",
      "highlight",
      async () => {
        block.translation = "已修改";
        return "accept";
      },
    ),
    /更新/,
  );
});

test("context-menu preview is read-only and prepared manual pair persists", async () => {
  const { block, newBridge, setGlossary, items } = fixture(async () => {
    throw Error("no network");
  });
  await setGlossary({ tradition: "传统" });
  const bridge = newBridge();
  await bridge.start();
  const start = block.translation.indexOf("传统");
  const prepared = await bridge.resolvePair(
    block,
    "translation",
    start,
    start + 2,
  );
  assert.equal(items.size, 0);
  assert.equal(block.source.slice(...prepared.counterpart), "tradition");
  const key = await bridge.create(
    block,
    "translation",
    start,
    start + 2,
    "#ffd400",
    "highlight",
    async () => "accept",
    prepared,
  );
  assert.equal(bridge.isLocal(key), false);
  const reopened = newBridge();
  await reopened.start();
  assert.equal(
    reopened.mappings(block).find((m) => m.annotationKey === key)?.translation
      .startOffset ?? reopened.binding(key).mapping.translation.startOffset,
    start,
  );
  const stale = { ...prepared, translation: "outdated" };
  await assert.rejects(
    bridge.create(
      block,
      "translation",
      start,
      start + 2,
      "#ffd400",
      "highlight",
      async () => "accept",
      stale,
    ),
    /更新/,
  );
});

test("native PDF underline is aligned and restored after reopening", async () => {
  const { block, items, newBridge } = fixture();
  const start = block.source.indexOf("collective memory");
  items.set("NATIVE", {
    key: "NATIVE",
    annotationType: "underline",
    annotationColor: "#5fb236",
    annotationComment: "",
    annotationPosition: JSON.stringify({
      pageIndex: 0,
      rects: [[start * 5, 700, (start + 17) * 5, 710]],
    }),
  });
  Zotero.Prefs.get = () => "model-config";
  let bridge = newBridge();
  await bridge.start();
  let calls = 0;
  bridge.resolvePair = async () => {
    calls++;
    return { counterpart: [4, 8] };
  };
  await bridge.reconcile(block);
  assert.equal(calls, 1);
  assert.equal(bridge.mappings(block)[0].translation.text, "集体记忆");
  assert.equal(bridge.mappings(block)[0].type, "underline");
  assert.equal(bridge.mappings(block)[0].color, "#5fb236");
  await bridge.reconcile(block);
  assert.equal(calls, 1);
  bridge.dispose();
  bridge = newBridge();
  await bridge.start();
  assert.equal(bridge.mappings(block)[0].translation.text, "集体记忆");
  bridge.dispose();
});

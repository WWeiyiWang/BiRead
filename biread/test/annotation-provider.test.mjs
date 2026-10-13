import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "biread-provider-"));
await build({
  entryPoints: ["src/bilingual/translation/providers.ts"],
  outfile: join(dir, "p.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "transport",
      setup(b) {
        b.onResolve({ filter: /utils\/(task|prefs)$/ }, (a) => ({
          path: a.path,
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
          contents: a.path.endsWith("prefs")
            ? 'export const getPref = k => k === "translateSource" ? globalThis.provider : "";'
            : "export class TranslateTaskRunner { constructor(fn){this.fn=fn} async run(task){await this.fn(task)} }",
          loader: "js",
        }));
      },
    },
  ],
});
const { annotationCandidate } = await import(pathToFileURL(join(dir, "p.mjs")));
await rm(dir, { recursive: true, force: true });
const context = {
  source: "Collect soil samples.",
  translation: "采集土壤样本。",
  side: "translation",
  selected: "土壤样本",
  selectionStart: 2,
  selectionEnd: 6,
};
test("Google reverse matching actually calls translation with Chinese to English", async () => {
  globalThis.provider = "google";
  let called = 0;
  globalThis.addon = {
    data: {
      translate: {
        services: {
          getServiceById: () => ({
            type: "sentence",
            translate: async (t) => {
              called++;
              assert.equal(t.raw, "土壤样本");
              assert.equal(t.langfrom, "zh-CN");
              assert.equal(t.langto, "en");
              assert.equal(t.bilingualInstruction, undefined);
              t.result = "soil samples";
              t.status = "success";
            },
          }),
        },
      },
    },
  };
  assert.equal(
    JSON.parse(await annotationCandidate(context, 1)).quote,
    "soil samples",
  );
  assert.equal(called, 1);
});
test("Google forward matching and provider failures are not silently skipped", async () => {
  globalThis.provider = "google";
  globalThis.addon.data.translate.services.getServiceById = () => ({
    type: "sentence",
    translate: async (t) => {
      assert.equal(t.langfrom, "en");
      assert.equal(t.langto, "zh-CN");
      t.status = "success";
      t.result = "土壤样本";
    },
  });
  assert.equal(
    JSON.parse(
      await annotationCandidate(
        { ...context, side: "source", selected: "soil samples" },
        1,
      ),
    ).quote,
    "土壤样本",
  );
  globalThis.addon.data.translate.services.getServiceById = () => ({
    type: "sentence",
    translate: async (t) => {
      t.status = "error";
      t.result = "network";
    },
  });
  await assert.rejects(annotationCandidate(context, 1), /网络/);
});

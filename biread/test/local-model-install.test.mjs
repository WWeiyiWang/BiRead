import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "biread-installer-"));
await build({
  entryPoints: ["src/bilingual/alignment/installLocalModel.ts"],
  outfile: join(dir, "test.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "fixtures",
      setup(b) {
        b.onResolve(
          {
            filter:
              /utils\/prefs|cache\/documentCache|\.\/localModel$|\.\/installAssets$/,
          },
          (a) => ({ path: a.path, namespace: "stub" }),
        );
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
          contents: a.path.includes("prefs")
            ? "export const setPref=(k,v)=>globalThis.saved=v;"
            : a.path.includes("documentCache")
              ? 'export const cacheRoot=()=>"/cache";'
              : a.path.endsWith("localModel")
                ? "export const runLocalModel=(...args)=>globalThis.smoke(...args);"
                : 'export const installAssets=[{name:"test",url:"https://example.org/test",bytes:1,sha256:"61",target:"model/test",archive:false}];',
        }));
      },
    },
  ],
});
const { installLocalModel } = await import(
  pathToFileURL(join(dir, "test.mjs"))
);
await rm(dir, { recursive: true, force: true });
function setup({ existing = false, corrupt = false, fail = false } = {}) {
  const files = new Set(
    existing ? ["/cache/alignment-win-x64-v1/local-model.json"] : [],
  );
  let downloads = 0;
  globalThis.saved = "original-config";
  globalThis.Services = { appinfo: { OS: "WINNT", XPCOMABI: "x86_64-msvc" } };
  globalThis.PathUtils = {
    join: (...x) => x.join("/"),
    parent: (p) => p.slice(0, p.lastIndexOf("/")),
  };
  globalThis.IOUtils = {
    exists: async (p) => files.has(p),
    makeDirectory: async () => {},
    stat: async () => ({ size: 1 }),
    move: async (a, b) => files.add(b),
    copy: async () => {},
    writeJSON: async (p) => files.add(p),
  };
  globalThis.Ci = { nsICryptoHash: { SHA256: 1 } };
  globalThis.Cc = new Proxy(
    {},
    {
      get: (_, key) => ({
        createInstance: () =>
          key.includes("input-stream")
            ? { init() {}, close() {} }
            : {
                init() {},
                updateFromStream() {},
                finish: () => (corrupt ? "b" : "a"),
              },
      }),
    },
  );
  globalThis.Zotero = {
    File: { pathToFile: (p) => p },
    getMainWindow: () => ({ setTimeout, clearTimeout }),
  };
  globalThis.ChromeUtils = {
    importESModule: () => ({
      Downloads: {
        createDownload: async () => ({
          currentBytes: 1,
          start: async () => {
            downloads++;
          },
          cancel: async () => {},
          finalize: async () => {},
        }),
      },
    }),
  };
  globalThis.smoke = async () => {
    if (fail) throw Error("smoke failed");
    return { links: [[1, 2]] };
  };
  return () => downloads;
}
test("unsupported platforms leave existing configuration untouched", async () => {
  setup();
  Services.appinfo.OS = "Darwin";
  await assert.rejects(
    installLocalModel(() => {}),
    /Windows/,
  );
  assert.equal(saved, "original-config");
});
test("corrupt downloads cannot activate a model", async () => {
  setup({ corrupt: true });
  await assert.rejects(
    installLocalModel(() => {}),
    /校验失败/,
  );
  assert.equal(saved, "original-config");
});
test("model must pass runtime check before activation; retry remains possible", async () => {
  setup({ fail: true });
  await assert.rejects(
    installLocalModel(() => {}),
    /smoke failed/,
  );
  assert.equal(saved, "original-config");
  setup();
  await installLocalModel(() => {});
  assert.equal(saved, "/cache/alignment-win-x64-v1/local-model.json");
});
test("existing installation is checked and reused without downloading", async () => {
  const count = setup({ existing: true });
  await installLocalModel(() => {});
  assert.equal(count(), 0);
  assert.notEqual(saved, "original-config");
});
test("parallel readers share one installation", async () => {
  const count = setup();
  const a = installLocalModel(() => {});
  const b = installLocalModel(() => {});
  assert.equal(a, b);
  await Promise.all([a, b]);
  assert.equal(count(), 1);
});

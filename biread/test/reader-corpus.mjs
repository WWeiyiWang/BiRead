// Reader integration audit: native PDF extraction, rendering, controller and UI. Requires Zotero's PDF.js build with getPageData.
// node test/reader-corpus.mjs manifest.json pdfjs-directory playwright-module-directory output.json
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
const [manifestPath, pdfjsDir, playwrightDir, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: node test/reader-corpus.mjs manifest.json pdfjs-dir playwright-dir output.json",
  );
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { chromium } = createRequire(import.meta.url)(playwrightDir);
const bundle = await build({
  stdin: {
    contents:
      'export {extractDocument} from "./src/bilingual/parser/pdfTextExtractor"; export {graphicsRects} from "./src/bilingual/parser/figureRegions"; export {figurePreviews} from "./src/bilingual/reader/figurePreviews"; export {FigureController} from "./src/bilingual/ui/figureController"; export {PageLayout} from "./src/bilingual/ui/pageLayout"; export {BilingualView} from "./src/bilingual/ui/bilingualView";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Audit",
  plugins: [
    {
      name: "prefs",
      setup(b) {
        b.onResolve({ filter: /utils\/prefs/ }, () => ({
          path: "prefs",
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents:
            "export const getPref=()=>undefined;export const setPref=()=>{};",
        }));
      },
    },
  ],
});
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const results = [];
try {
  for (const entry of manifest) {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 1000 },
    });
    try {
      await page.route("**/*", async (route) => {
        const name = new URL(route.request().url()).pathname;
        if (name === "/")
          return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: "<!doctype html><html><body></body></html>",
          });
        if (name === "/bundle.js")
          return route.fulfill({
            contentType: "text/javascript; charset=utf-8",
            body: bundle.outputFiles[0].text,
          });
        if (name === "/paper.pdf")
          return route.fulfill({
            contentType: "application/pdf",
            body: readFileSync(entry.path),
          });
        if (["/pdf.mjs", "/pdf.worker.mjs"].includes(name))
          return route.fulfill({
            contentType: "text/javascript; charset=utf-8",
            body: readFileSync(join(pdfjsDir, name.slice(1))),
          });
        return route.abort();
      });
      await page.goto("http://layout.local/");
      await page.addScriptTag({ url: "http://layout.local/bundle.js" });
      const result = await page.evaluate(async (entry) => {
        const errors = [];
        window.Zotero = {
          Promise: { delay: (ms) => new Promise((r) => setTimeout(r, ms)) },
          logError: (e) => errors.push(String(e)),
        };
        window.Components = {
          utils: {
            waiveXrays: (x) => x,
            cloneInto: (x) => x,
            createObjectIn: () => ({}),
          },
        };
        window.IntersectionObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
        const lib = await import("/pdf.mjs");
        lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
        const pdf = await lib.getDocument({ url: "/paper.pdf" }).promise;
        const doc = await Audit.extractDocument(
          {
            numPages: pdf.numPages,
            getPageLabels: () => pdf.getPageLabels(),
            getPageData: (p) => pdf.getPageData(p),
            getGraphics: async (i) =>
              Audit.graphicsRects(
                await (
                  await pdf.getPage(i + 1)
                ).getOperatorList({ annotationMode: 0 }),
              ),
          },
          "audit",
          "audit",
          () => {},
          () => false,
        );
        const blocks = doc.blocks;
        window.auditBlocks = blocks;
        window.ui = new Audit.BilingualView(
          document,
          () => {},
          () => {},
        );
        ui.showBlocks(blocks);
        const initialEquations = [
          ...document.querySelectorAll('[data-kind="equation"] > .bi-columns'),
        ];
        if (
          initialEquations.some((e) => getComputedStyle(e).display !== "none")
        )
          throw Error("Raw equation visible before load");
        let renders = 0,
          embeddedCalls = 0,
          count = 0;
        const wrapped = {
          getPage: async (n) => {
            const p = await pdf.getPage(n);
            return new Proxy(p, {
              get(t, k) {
                if (k === "render")
                  return (...args) => {
                    renders++;
                    return t.render(...args);
                  };
                const v = t[k];
                return typeof v === "function" ? v.bind(t) : v;
              },
            });
          },
        };
        const integration = {
          pdf: {
            getFigures: async (i, bs, cancelled) => {
              const imgs = await Audit.figurePreviews(
                wrapped,
                window,
                i,
                bs,
                cancelled,
              );
              count += imgs.length;
              return imgs;
            },
            getImages: async () => {
              embeddedCalls++;
              return { images: [], skipped: 0 };
            },
          },
        };
        const controller = new Audit.FigureController(ui, integration, blocks);
        for (const i of [...new Set(blocks.map((b) => b.pageIndex))])
          await controller.loadPage(i);
        if (document.querySelectorAll(".bi-equation-loading").length)
          throw Error("Equations missing after controller load");
        if (
          [...document.querySelectorAll(".bi-image-loader")].some((e) =>
            /失败|未完成/.test(e.textContent),
          )
        )
          throw Error(
            "Preview controller reported failure: " + errors.join("; "),
          );
        for (const b of blocks) {
          const ids = [
            ...(["equation", "original-page", "caption"].includes(b.kind) &&
            !blocks.some((c) => c.table?.captionID === b.id)
              ? [b.id]
              : []),
            ...(b.inlineMath || []).map((m) => m.id),
          ];
          for (const id of ids) {
            const selector =
              id === b.id
                ? `[data-block-id="${id}"] .bi-figure img`
                : `[data-inline-math="${id}"] img`;
            const imgs = [...document.querySelectorAll(selector)];
            if (!imgs.length) throw Error(`Missing original ${id}`);
            for (const img of imgs) await img.decode();
          }
        }
        for (const expected of entry.expect || []) {
          const b = blocks.find((b) => b.source.includes(expected.text));
          if (
            !b ||
            b.kind !== expected.kind ||
            (expected.level && b.headingLevel !== expected.level) ||
            (expected.contains &&
              !expected.contains.every((text) => b.source.includes(text))) ||
            (expected.minInline &&
              (b.inlineMath?.length || 0) < expected.minInline)
          )
            throw Error(`Classification failed: ${expected.text}`);
        }
        for (const excluded of entry.exclude || [])
          if (blocks.some((b) => b.source.includes(excluded)))
            throw Error(`Unexpected body content: ${excluded}`);
        controller.dispose();
        for (const b of blocks.filter((b) => b.inlineMath?.length)) {
          b.translation =
            "原文参数与公式：" +
            b.inlineMath.map((m) => m.token).join("，") +
            "。";
          ui.update(b, []);
          ui.update(b, []);
          for (const m of b.inlineMath)
            if (
              document.querySelectorAll(`[data-inline-math="${m.id}"] img`)
                .length !== 2
            )
              throw Error("Inline image lost after translation update");
        }
        window.auditBlocks = blocks;
        return {
          pages: pdf.numPages,
          blocks: blocks.length,
          previews: count,
          pageRenders: renders,
          embeddedCalls,
          fallback: blocks
            .filter((b) => b.kind === "original-page")
            .map((b) => ({ page: b.pageIndex + 1, issues: b.layoutIssues })),
        };
      }, entry);
      mkdirSync(dirname(outputPath), { recursive: true });
      for (const shot of entry.previewShots || []) {
        const src = await page.evaluate((shot) => {
          const b = auditBlocks.find(
            (b) =>
              b.pageIndex + 1 === shot.page &&
              (!shot.text || b.source.includes(shot.text)) &&
              (!shot.kind || b.kind === shot.kind),
          );
          if (!b)
            throw Error("Preview block not found: " + JSON.stringify(shot));
          const img = document.querySelector(
            `[data-block-id="${b.id}"] .bi-figure img`,
          );
          if (!img) throw Error("Preview image not found: " + b.id);
          return img.src;
        }, shot);
        writeFileSync(
          join(dirname(outputPath), entry.name + "-" + shot.name + ".png"),
          Buffer.from(src.split(",")[1], "base64"),
        );
      }
      for (const shot of entry.screenshots || []) {
        await page.evaluate((shot) => {
          const b = auditBlocks.find((b) => b.source.includes(shot.text));
          if (!b) throw Error("Screenshot block not found");
          if (shot.translation) {
            b.translation = shot.translation;
            ui.update(b, []);
          }
          ui.scrollTo(b.id);
        }, shot);
        await page.screenshot({
          path: join(
            dirname(outputPath),
            entry.name + "-" + shot.name + ".png",
          ),
        });
      }
      await page.evaluate(() => {
        ui.setContinuousReading(false);
        ui.root.dataset.readingMode = "compare";
        window.pageLayout = new Audit.PageLayout(ui, () => auditBlocks);
        pageLayout.set(true);
      });
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        for (const img of document.querySelectorAll("[data-inline-math] img"))
          if (getComputedStyle(img).position === "absolute")
            throw Error(
              "Inline formula removed from text flow in compare mode",
            );
        if (
          document.querySelectorAll(".bi-paper").length !==
          new Set(auditBlocks.map((b) => b.pageIndex)).size
        )
          throw Error("Missing compare page");
        pageLayout.dispose();
      });
      results.push({ name: entry.name, ...result });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      if (entry.auditDetails) {
        mkdirSync(dirname(outputPath), { recursive: true });
        const details = await page.evaluate(() =>
          (window.auditBlocks || []).map((b) => ({
            id: b.id,
            page: b.pageIndex + 1,
            kind: b.kind,
            source: b.source,
            region: b.originalRegion,
            inline: b.inlineMath,
          })),
        );
        writeFileSync(
          join(dirname(outputPath), entry.name + "-layout.json"),
          JSON.stringify(details, null, 2),
        );
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(outputPath, JSON.stringify(results, null, 2));

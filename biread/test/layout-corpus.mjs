// Local integration audit. Requires Zotero's PDF.js build with getPageData.
// node test/layout-corpus.mjs manifest.json pdfjs-directory playwright-module-directory output.json
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const [manifestPath, pdfjsDir, playwrightDir, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: node test/layout-corpus.mjs manifest.json pdfjs-dir playwright-dir output.json",
  );
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { chromium } = createRequire(import.meta.url)(playwrightDir);
const bundle = await build({
  stdin: {
    contents:
      'export {extractDocument} from "./src/bilingual/parser/pdfTextExtractor"; export {graphicsRects} from "./src/bilingual/parser/figureRegions";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Audit",
});
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const results = [];
try {
  for (const entry of manifest) {
    const page = await browser.newPage();
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
      const result = await page.evaluate(async () => {
        window.Zotero = {
          Promise: { delay: (ms) => new Promise((r) => setTimeout(r, ms)) },
          logError: console.error,
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
        return {
          pages: pdf.numPages,
          blocks: doc.blocks.length,
          fallback: doc.blocks
            .filter((b) => b.kind === "original-page")
            .map((b) => ({ page: b.pageIndex + 1, issues: b.layoutIssues })),
        };
      });
      results.push({ name: entry.name, ...result });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(outputPath, JSON.stringify(results, null, 2));
